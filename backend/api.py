import os
import json
import pytz
import datetime
import holidays
import uvicorn
import asyncio
from collections import deque
from decimal import Decimal
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from longport.openapi import QuoteContext, TradeContext, Config, SubType, PushQuote, OrderType, OrderSide, OrderStatus, StrikePriceInfo, TimeInForceType, Period, AdjustType, OpenApiException


print('\nStarting longtrade backend service...\n')

holidays = holidays.NYSE()
eastern = pytz.timezone('US/Eastern')
open_time=datetime.time(9, 30)
close_time=datetime.time(16, 0)

def is_trading_now():
    today = datetime.datetime.now(eastern)
    now = today.time()
    return (today.weekday() < 5) and (today not in holidays) and (open_time <= now <= close_time)
# --------------------
# longport
# --------------------
with open(os.path.expanduser("~")+'/token.json') as f:
    token_str = f.read()
token = json.loads(token_str)
config = Config(
    app_key=token['app_key'],
    app_secret = token['app_secret'],
    access_token = token['real']
    )
q = QuoteContext(config)
tr = TradeContext(config)

with open('tks.txt') as f:
    tks = [i.strip() for i in f.readlines()]

def fmt(tk):
    return f'{tk.upper()}.US'

def rfmt(ticket):
    return ticket[:-3].lower()

def get_opt_type(symbol):
    for char in symbol[::-1]:
        if char == 'C': return 'Call'
        if char == 'P': return 'Put'

last_quote = q.quote([fmt(tk) for tk in tks])
if not is_trading_now():
    yes = {
        rfmt(x.symbol): x.last_done # => prevClose when trading starts
        for x in last_quote
        }
else:
    yes = {
            rfmt(x.symbol): x.prev_close
            for x in last_quote
        }
# --------------------
# fastapi
# --------------------
app = FastAPI()
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ------------------------
# real time quote
# ------------------------
# in-memory db
memory = 50
global quotes; quotes = {tk: deque([Decimal('0.0')]*memory) for tk in tks}
global vol; vol = {tk: [Decimal('0'), Decimal('0')] for tk in tks}
global resist; resist = {tk: Decimal('0.0') for tk in tks}
global diff; diff = {tk: Decimal('0.0') for tk in tks}
global mm; mm = {tk: {'max': False, 'min': False} for tk in tks}

def handle_quote(ticket: str, event: PushQuote):
    tk = rfmt(ticket)
    p = quotes[tk]
    new = event.last_done - yes[tk]  # use Decimal
    new = round(new, 3)
    d1, d2 = new - p[-1], p[-1] - p[-2]
 
    vol[tk][0] = vol[tk][1]
    vol[tk][1] = event.volume
    
    mm[tk]['max'] = new > max(p)
    mm[tk]['min'] = new < min(p)

    p.append(new)
    p.popleft()

    diff[tk] = round((p[-1]+p[-2]+p[-3]) / Decimal('3.0') - (p[0]+p[1]+p[2]) / Decimal('3.0'), 2)

    # calculate resist
    if d1 * d2 <= Decimal('0'):
        resist[tk]  = resist[tk] + abs(d1)
        resist[tk] = min(resist[tk], Decimal('30.0'))
    else:
        a = Decimal('2.0')
        resist[tk] =  resist[tk] * a / (abs(d1) + a)

@app.websocket("/quote")
async def quote_stock(websocket: WebSocket):
    await websocket.accept()
    q.set_on_quote(handle_quote)
    q.subscribe([fmt(t) for t in tks], [SubType.Quote], is_first_push=True)
    print('subscribed to all tickets')
    try:
        msg = await websocket.receive_text()
        print(msg)
        while True:
            await websocket.send_json({
                "data" : [
                    {
                    "tk": tk,
                    "p": quotes[tk][-1], 
                    "r": resist[tk],
                    "vol": vol[tk][1] - vol[tk][0],
                    "diff": diff[tk],
                    "mm": mm[tk]
                    }  
                    for tk in tks]
            })
            await asyncio.sleep(0.25)
            
    except WebSocketDisconnect:
        q.unsubscribe([fmt(t) for t in tks], [SubType.Quote])
        print('unsubscribed from all tickets')

@app.websocket("/quote-option")
async def quote_option(websocket: WebSocket):
    await websocket.accept()
    symbol = await websocket.receive_text()
    option_type = get_opt_type(symbol)
    try:
        while True:
            res = q.option_quote([symbol])[0]
            await websocket.send_json({
                'price': res.last_done,
                'type': option_type,
                'strike': res.strike_price,
                'exp': res.expiry_date.strftime("%m/%d"),
                'open': res.open_interest,
                # 'volume': res.volume,
                # 'implied_volatility': res.implied_volatility,
                })
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass

@app.get('/stat/')
def get_stat(tk):
    res = q.quote([fmt(tk)])[0]
    prevClose = res.last_done if not is_trading_now() else res.prev_close
    high = res.high - res.prev_close
    low = res.low - res.prev_close
    data = {
        'prevClose': prevClose,
        'max': high,
        'min': low,
    }
    return data
# ------------------------
# get factors
# ------------------------
@app.get('/capflow/')
def get_capital_flow(tk: str):
    flow, timestamp = 0, 0
    response = q.capital_flow(fmt(tk))
    if response:
        flow = response[-1].inflow
        flow = round(flow / Decimal('1e6'), 2)

        timestamp = response[-1].timestamp.astimezone(eastern).strftime('%m.%d %H:%M')

    dist = q.capital_distribution(fmt(tk))
    large = dist.capital_in.large - dist.capital_out.large
    medium = dist.capital_in.medium - dist.capital_out.medium
    small = dist.capital_in.small - dist.capital_out.small
    supp = [
        {
        'cls':'🔴' if large <=0 else '🟢', 
        'val': f'large: {round(large / Decimal('1e6'), 2)}M'
        },
        {
        'cls':'🔴' if medium <=0 else '🟢', 
        'val': f'medium: {round(medium / Decimal('1e6'), 2)}M'
        },
        {
        'cls':'🔴' if small <=0 else '🟢', 
        'val': f'small: {round(small / Decimal('1e6'), 2)}M'
        },
    ]
    res = {
        'cls': '🔴' if flow <= 0 else '🟢',
        'value': f'{flow}M',
        'timestamp': timestamp,
        'supp': supp,
        'title': 'cap'
    }
    return res

# prev1, prev2, prev3, prev4, prev5 etc. con-offset closes
def get_prev_closes(tk):
    res = q.candlesticks(fmt(tk), Period.Day, 12, AdjustType.ForwardAdjust)
    data = [i.close for i in res]
    data = data[:-1] if is_trading_now() else data
    closes = [data[j] - data[j-1] for j in range(len(data)-1, 0, -1)]
    closes = [round(i, 2) for i in closes]
    return closes

# pre-market percentage change from prev close
def get_pre_market(tk):
    pres = q.quote([fmt(tk), 'QQQ.US', 'SPY.US'])
    pre = pres[0].pre_market_quote
    pre_spy = pres[2].pre_market_quote
    pre_qqq = pres[1].pre_market_quote

    r = round(((pre.last_done - pre.prev_close) / pre.prev_close) * 100, 2)
    
    r_spy = round(((pre_spy.last_done - pre_spy.prev_close) / pre_spy.prev_close) * 100, 2)
    r_qqq = round(((pre_qqq.last_done - pre_qqq.prev_close) / pre_qqq.prev_close) * 100, 2)

    r_spy_str = f'+{r_spy}%' if r_spy > 0 else f'{r_spy}%'
    r_qqq_str = f'+{r_qqq}%' if r_qqq > 0 else f'{r_qqq}%'
    
    supp = [
        {
        'cls':'🔴' if r_spy <=0 else '🟢', 
        'val': 'SPY ' + r_spy_str
        },
        {
        'cls':'🔴' if r_qqq <=0 else '🟢', 
        'val': 'QQQ ' + r_qqq_str,
        }
    ]
    return r, supp

@app.get('/iv/')
def get_iv(tk: str):
    data = get_option_list(tk, ret='iv')
    cls = '🔴' if data['iv'] > data['hv'] else '🟢'
    puts = [f'{round(i*100, 1)}%' for i in data['puts']]
    calls = [f'{round(i*100, 1)}%' for i in data['calls']]

    head = [{'cls': cls, 'val': 'Put   －S－   Call'}]
    supp = head + [
        {'cls': cls,
        'val': f'{puts[i]} －{data['strikes'][i]}－ {calls[i]}' 
        }
        for i in range(len(puts))
    ]

    res = {   
            'cls': cls,
            'value': f'{round(data['iv']*100, 1)}% / {round(data['hv']*100, 1)}%',
            'supp': supp,
            'timestamp': data['timestamp'],
            'title': 'IV'
         }
    return res

@app.get('/corr/')
async def get_corr(tk: str):
    data = {}
    for t in tks:
        data[t] = [i.avg_price for i in q.intraday(fmt(t))]
        await asyncio.sleep(0.1)
    corrs = [
        {
            'tk': t, 
            'val': quotes[t][-1],
            'corr':round(pd.Series(data[t]).corr(pd.Series(data[tk])), 2)
         } 
    for t in tks if t != tk
    ]
    # corr 1 to -1
    corrs = sorted(corrs, key=lambda x: x['corr'], reverse=True)
    supp = [
        {
        'cls':'🔴' if item['val'] <=0 else '🟢', 
        'val':f'{item['tk']} {item['corr']}'
        } 
    for item in corrs[1:]
    ]
    
    res = {   
            'cls': '🔴' if corrs[0]['val'] <= 0 else '🟢', 
            'value': f'{corrs[0]['tk']} 𝜸={corrs[0]['corr']}', 
            'timestamp': datetime.datetime.now(eastern).strftime('%m.%d %H:%M'),
            'supp': supp,
            'title': 'corr'
         }

    return res

@app.get('/factors/')
def get_factors(tk):
    # pre-market change rate
    r, supp_pre = get_pre_market(tk)
    # previous close changes
    vals = get_prev_closes(tk) 
    classes = ['🔴' if val < 0 else '🟢' for val in vals]
    closes = [{'cls':x, 'val':f'+{y}' if y > 0 else y} for x, y in zip(classes, vals)]

    data = [
        {   
            'cls': '⚪️', 
            'value': 0, 
            'title': 'cap'
         },
         {   
            'cls': '⚪️', 
            'value': 0, 
            'supp': [],
            'title': 'corr'
         },
        {
            'cls': '🔴' if r < 0 else '🟢',
            'value': f'+{r}%' if r > 0 else f'{r}%',
            'supp': supp_pre,
            'title': 'pre-market',
        },
        {
            'cls': closes[0]['cls'],
            'value': closes[0]['val'],
            'supp': closes,
            'title': 'prev.'
        },
    ]

    data.append(get_iv(tk))
    return data
# ------------------------
# place order
# ------------------------
class Order(BaseModel):
    tk: str
    option: str | None  # put | call
    side: str  # buy | sell
    order_type: str = 'MO'  # MO | LO
    qty: str | int = 'min'  # min | max | mmax | #n
    money: str = 'itm'  # itm | otm

global ostack; ostack = {tk: {'put':[], 'call':[]} for tk in tks}
unclosed = tr.stock_positions().channels[0].positions  # 持仓
if unclosed:
    for pos in unclosed:
        # option name to tk
        split = pos.symbol_name.split(' ')
        tk, option = split[0].lower(), split[-1].lower()
        data = {
                'id': f'HIST-{pos.symbol}',
                'success': True,
                'symbol': pos.symbol, 
                'option': option,
                'status': 'filled',
                'side': 'buy',
                'tk': tk,
                'qty': pos.quantity,
                'exec_price': pos.cost_price,  # Decimal
                }
        if tk in tks:
            ostack[tk][option].append(data)

@app.get('/position/')
def get_position(tk):
    last_put, last_call = {}, {}
    puts = ostack[tk]['put']  # default is []
    calls = ostack[tk]['call']
    if puts:
        # update last order status
        if puts[-1]['status'] != 'filled':
            detail = tr.order_detail(puts[-1]['id'])
            if detail.status == OrderStatus.Filled:
                puts[-1].update({'status':'filled', 'exec_price': detail.executed_price})

            elif detail.status in [OrderStatus.Canceled, OrderStatus.Rejected]:
                puts.pop()  # can possibly alter puts to []

        # return position if bought
        if len(puts) >= 1:
            if puts[-1]['side'] == 'buy':
                last_put = puts[-1]
    if calls:
        if calls[-1]['status'] != 'filled':
            detail = tr.order_detail(calls[-1]['id'])
            if detail.status == OrderStatus.Filled:
                calls[-1].update({'status':'filled', 'exec_price': detail.executed_price})

            elif detail.status in [OrderStatus.Canceled, OrderStatus.Rejected]:
                calls.pop()

        # return position if bought
        if len(calls) >= 1:
            if calls[-1]['side'] == 'buy':
                last_call = calls[-1]

    return {'put': last_put, 'call': last_call}

def _find_near_idx(res: list[StrikePriceInfo], S):
    left, right = 0, len(res) - 1
    while left <= right:
        mid = (left + right) // 2
        if res[mid].price == S:
            return mid, mid
        elif res[mid].price < S:
            left = mid + 1
        else:
            right = mid - 1
    return right, left

@app.get('/preview/')
def get_option_list(tk, typ='put', ret='price'):  # ret = 'symbol' | 'price' | 'iv' 
    # 1. get T
    today = datetime.date.today()
    # friday = today + datetime.timedelta((4 - today.weekday()) % 7 + 7)
    if today.weekday() <= 1: # Mon, Tue  -> fri., Wed, Thu, Fri -> next fri.
        friday = today + datetime.timedelta((4 - today.weekday()))
    else:
        friday = today + datetime.timedelta((4 - today.weekday()) + 7)
    # 2. get X
    S = q.quote([fmt(tk)])[0].last_done
    res = q.option_chain_info_by_date(fmt(tk), friday)
    l, r = _find_near_idx(res, S)
    index = [l-2, l-1, l, r, r+1, r+2]
    puts = [res[i].put_symbol for i in index]
    calls = [res[i].call_symbol for i in index]
    symbols = puts if typ == 'put' else calls
    strikes = [res[i].price for i in index]
    
    if ret == 'symbol':
        return symbols
    
    if ret == 'price':
        res = q.option_quote(symbols)
        prices = [i.last_done for i in res]
        # if typ=='put': prices = prices[::-1] # per display
        return prices
    
    if ret == 'iv':
        res = q.option_quote(puts+calls)
        ivs = [i.implied_volatility for i in res]
        hvs =  [i.historical_volatility for i in res]
        
        # average call IV, average put IV
        mean_iv = sum(ivs) / len(ivs)
        mean_hv = sum(hvs) / len(hvs)

        data = {
            'iv': mean_iv,
            'hv': mean_hv,
            'puts':ivs[:6],
            'calls': ivs[6:],
            'strikes': strikes,
            'timestamp': res[0].timestamp.astimezone(eastern).strftime('%m.%d %H:%M'),
        }

        return data

def find_option(tk: str, typ: str, qty='min', money='itm'):  # typ = 'call' or 'put'
    """return target (symbol, qty) for purchasing"""

    opts = get_option_list(tk=tk, typ=typ, ret='symbol')

    if f'{typ}-{money}' in ['put-otm', 'call-itm']: opts = opts[:3]  # -1-2-3-----
    if f'{typ}-{money}' in ['put-itm', 'call-otm']: opts = opts[3:]  # -----1-2-3-

    for symbol in opts:
        try:
            res = tr.estimate_max_purchase_quantity(symbol=symbol, order_type=OrderType.MO, side=OrderSide.Buy)
            cash_qty, margin_qty = res.cash_max_qty, res.margin_max_qty
        except OpenApiException:
            continue
        
        if qty == 'min' and cash_qty >= 1: qty_out = 1
        elif type(qty) == int: qty_out = min(qty, cash_qty)
        elif qty == 'max': qty_out = cash_qty
        elif qty == 'mmax': qty_out = margin_qty
        if qty_out > 0: return symbol, qty_out

    return '', 0

@app.post("/order")
async def place_order(order: Order):

    order_type = OrderType.MO
    submitted_price = None

    if order.side == 'buy':
        side = OrderSide.Buy
        symbol, qty = find_option(order.tk, typ=order.option, 
                                  qty=order.qty, money=order.money)
        if symbol == '':
            return {
                'success': False, 
                'message': 'suitable target not found.'
            }
        
        if order.order_type == 'LO':
            order_type = OrderType.LO
            submitted_price = q.depth(symbol).bids[0].price - Decimal('0.05')

    if order.side == 'sell':
        side = OrderSide.Sell
        last = ostack[order.tk][order.option][-1]
        symbol, qty = last['symbol'], last['qty']

        if order.order_type == 'LO':
            order_type = OrderType.LO
            submitted_price = q.depth(symbol).asks[0].price
    
    response = tr.submit_order(symbol=symbol, 
                               order_type=order_type,
                               side=side,
                               submitted_quantity=qty,
                               time_in_force=TimeInForceType.Day,
                               submitted_price=submitted_price
                                )   
    
    await asyncio.sleep(0.5)
    detail = tr.order_detail(response.order_id)
    exec_price, cost, profit = Decimal('0'), Decimal('0'), Decimal('0')

    if detail.status == OrderStatus.Filled:
        exec_price = detail.executed_price  # Decimal

        if order.side == 'buy':
            base = exec_price * qty
            cost = base * Decimal('100')
        if order.side == 'sell':
            base = (exec_price - ostack[order.tk][order.option][-1]['exec_price']) * qty
            profit = base * Decimal('100')

        success = True
        message = 'Order filled successfully.'
    
    else:
        success = True
        message = f'Order is submitted'
    
    status = str(detail.status).split('.')[-1].lower()
    time = detail.submitted_at
    data = {
        'id': detail.order_id,
        'success': success,
        'message': message,
        'status': status,
        'name': detail.stock_name,
        'symbol': detail.symbol,
        'option': order.option, # call | put
        'tk': order.tk,
        'side': order.side,
        'qty': detail.quantity,
        'exec_price': exec_price,
        'totalCost': cost,
        'profit': profit,
        'time': time,
    }

    ostack[order.tk][order.option].append(data)
    # all_records = ostack[order.tk]['put'] + ostack[order.tk]['call']
    # pd.DataFrame(all_records).to_csv(f'orders/{order.tk}-{datetime.datetime.today().strftime('%m.%d')}.csv')  
    return data


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8080)