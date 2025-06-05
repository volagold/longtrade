import os, re, json, math, pytz
import datetime, holidays
import uvicorn, asyncio
from collections import deque
from decimal import Decimal
import scipy.stats as stats
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from longport.openapi import QuoteContext, TradeContext, Config, SubType, PushQuote, PushDepth, OrderType, OrderSide, OrderStatus, StrikePriceInfo, TimeInForceType, Period, AdjustType, OpenApiException

print('\nStarting longtrade backend service...\n')

holidays = holidays.NYSE()
eastern = pytz.timezone('US/Eastern')
open_time=datetime.time(9, 0)
close_time=datetime.time(16, 0)
year = str(datetime.datetime.now(eastern).year)

def is_trading():
    today = datetime.datetime.now(eastern)
    now = today.time()
    return (today.weekday() < 5) and (today not in holidays) and (open_time <= now <= close_time)

trading = is_trading()
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

# def get_opt_type(symbol):
#     for char in symbol[::-1]:
#         if char == 'C': return 'Call'
#         if char == 'P': return 'Put'

last_quote = q.quote([fmt(tk) for tk in tks])
if not trading:
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
# in-memory storage
# ------------------------
memory = 50
full_price = {tk: Decimal('0.0') for tk in tks}
quotes = {tk: deque([Decimal('0.0')]*memory) for tk in tks}
vol = {tk: [Decimal('0'), Decimal('0')] for tk in tks}
resist = {tk: Decimal('0.0') for tk in tks}
mm = {tk: {'max': False, 'min': False} for tk in tks}
depth = {'bid':{'p':0, 'q':0}, 'ask': {'p': 0, 'q':0} }
# cache
explist = {tk:[] for tk in tks}
chain = {tk: {'put':dict(), 'call':dict()} for tk in tks}
ref = {id: tuple(), 'symidx': dict()}  # last strike table requested
positions = {'val': []}
# ------------------------
# real time quote
# ------------------------
def handle_quote(ticket: str, event: PushQuote):
    if len(ticket) > 10:  # options
        tk, type, eidx= ref['id']
        idx = ref['symidx'][ticket]
        data = chain[tk][type][eidx][idx]
        data['p'] = event.last_done
        data['ch'] = event.last_done - data['prev']
        data['min'] = event.low
        data['max'] = event.high
        data['vol'] = event.volume
    else:  # stocks
        tk = rfmt(ticket)
        full_price[tk] = event.last_done

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

        # resist
        if d1 * d2 <= Decimal('0'):
            resist[tk]  = resist[tk] + abs(d1)
            resist[tk] = min(resist[tk], Decimal('30.0'))
        else:
            a = Decimal('2.0')
            resist[tk] =  resist[tk] * a / (abs(d1) + a)

def handle_depth(symbol: str, event: PushDepth):
    """option depth"""
    depth['bid']['p'] = event.bids[0].price
    depth['bid']['q'] = event.bids[0].volume
    depth['ask']['p'] = event.asks[0].price
    depth['ask']['q'] = event.asks[0].volume

q.set_on_quote(handle_quote)
q.set_on_depth(handle_depth)
# APP250314P230000.US PushDepth { asks: [Depth { position: 1, price: 4.50, volume: 1, order_num: 0 }], bids: [Depth { position: 1, price: 3.00, volume: 186, order_num: 0 }] }
# APP250321P230000.US PushQuote { last_done: 3.90, open: 6.50, high: 8.80, low: 3.50, timestamp: "2025-03-07T21:00:00Z", volume: 1039, turnover: 537022.00, trade_status: Normal, trade_session: Normal }

@app.websocket("/quote")
async def quote_stock(websocket: WebSocket):
    await websocket.accept()
    # q.set_on_quote(handle_quote)
    q.subscribe([fmt(t) for t in tks], [SubType.Quote], is_first_push=True)
    print('subscribed to all tickets')
    try:
        while True:
            await websocket.send_json({
                "data" : [
                    {
                    "tk": tk,
                    "full_price": full_price[tk],
                    "p": quotes[tk][-1], 
                    "r": resist[tk],
                    "vol": vol[tk][1] - vol[tk][0],
                    "mm": mm[tk]
                    }  
                    for tk in tks]
            })
            await asyncio.sleep(0.2)
            
    except WebSocketDisconnect:
        q.unsubscribe([fmt(t) for t in tks], [SubType.Quote])
        print('unsub. from all tks')

@app.websocket("/quote-strikes")
async def quote_strikes(websocket: WebSocket):
    await websocket.accept()
    tk, type, eidx= ref['id']
    symlist = list(ref['symidx'].keys())
    q.subscribe(symlist, [SubType.Quote], is_first_push=True)
    try:
        while True:
            await websocket.send_json({
                'data': chain[tk][type][eidx]
            })
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        q.unsubscribe(symlist, [SubType.Quote])
        print('unsubscribed option table')

@app.websocket("/quote-depth")
async def quote_depth(websocket: WebSocket):
    await websocket.accept()
    symbol = await websocket.receive_text()
    q.subscribe([symbol], [SubType.Depth], is_first_push=True)
    print(f'sub. depth for {parse_symbol(symbol)}')
    try:
        while True:
            await websocket.send_json({
                'data': depth,
                })
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        q.unsubscribe([symbol], [SubType.Depth])
        print(f'ubsub. depth for {parse_symbol(symbol)}')

@app.get('/stat/')
def get_stat(tk):
    res = q.quote([fmt(tk)])[0]
    prevClose = res.last_done if not is_trading() else res.prev_close
    high = res.high - res.prev_close
    low = res.low - res.prev_close
    data = {
        'prevClose': prevClose,
        'max': high,
        'min': low,
    }
    return data

@app.get('/dates/')
def get_option_dates(tk: str):
    """option date list"""
    # use cached
    if explist[tk]:
        return explist[tk]
    lst = q.option_chain_expiry_date_list(fmt(tk))
    today = datetime.date.today()
    lst = [[i, (i - today).days] for i in lst]  # [Date, days]
    lst = lst[1:] if lst[0][1] < 0 else lst
    explist[tk] = lst
    return lst

def ziplist(*lists, keys):
    return [dict(zip(keys, values)) for values in zip(*lists)]

def parse_symbol(s: str, parts=False):
    """option symbol to readable format"""
    s = s.removesuffix('.US')
    tk = re.match(r"^[A-Z]{1,4}", s).group(0)
    remain = s.removeprefix(tk)
    date = remain[:6]  # e.g. '250411'
    if date.startswith(year[-2:]):
        exp = f'{date[2:4]}/{date[-2:]}'
    else:
        exp = f'{date[:2]}/{date[2:4]}/{date[-2:]}'
    
    remain = remain.removeprefix(date)
    t = 'Put' if remain.startswith('P') else 'Call'

    remain = remain[1:]
    decimal_part = int(remain[-3:]) * 0.001
    if decimal_part == 0.0:
        decimal_part = 0
    int_part = int(remain[:-3])
    strike = int_part + decimal_part

    name = f'{tk}💰{exp}💰{strike} {t}'
    
    if parts:
        dates = get_option_dates(tk.lower()) # list[date, days]
        yr = int(f'20{date[:2]}') 
        mo = int(date[2:4])
        day = int(date[4:])
        date = datetime.datetime(yr, mo, day).date()
        eidx = [i[0] for i in dates].index(date)
        days = dates[eidx][1]
        return {'tk':tk.lower(),
                'type': t.lower(),
                'eidx': eidx,
                'T': days,
                'strike':strike, 
                'name':name
                }
    else:
        return name

@app.get('/strikes/')
def get_strikes(tk: str, eidx: int, type: str, quote:bool=False, num:int=20, bias=10):
    """
    num: 2 x number of options to quote
    bias: add # more quotes to otm options
    """
    if (not trading) and eidx in chain[tk][type].keys():
        print(f'🟢 ret. cached chain for {tk} (date {eidx})')
        return chain[tk][type][eidx]
    res = q.option_chain_info_by_date(fmt(tk), explist[tk][eidx][0])
    symbols = [i.put_symbol for i in res] if type == 'put' else [i.call_symbol for i in res]
    names = [parse_symbol(s) for s in symbols]
    strikes = [i.price for i in res]
    out = ziplist(symbols, names, strikes, keys=['symbol', 'name', 'strike'])
    if quote:
        l, r = _find_near_idx(res, full_price[tk])
        start = max(0, l-num-bias if type=='put' else l-num)
        end = min(r+num+bias if type=='call' else r+num, len(res))
        quotes = q.option_quote(symbols[start:end])
        data = [{  # data/out
            'symbol': i.symbol,
            'name': parse_symbol(i.symbol),
            'strike': i.strike_price,
            'p': i.last_done,
            'prev':i.prev_close,
            'ch': i.last_done - i.prev_close,
            'min': i.low,
            'max': i.high,
            'vol': i.volume,
            'openInterest': i.open_interest,
            'iv': i.implied_volatility
        } for i in quotes]
        
        out[start:end] = data

    chain[tk][type][eidx] = out
    
    ref['id'] = (tk, type, eidx)
    ref['symidx'] = dict(zip(symbols[start:end], range(start, end)))
    
    return out

# ---------------------
# Option Pricing
# ---------------------
def N(x):
    return stats.norm.cdf(x)

def delta(s, X, T, r, sigma, typ='call'):
    d1 = (math.log(s/X) + (r + sigma**2/2)*T) / (sigma * math.sqrt(T))
    return N(d1) if typ == 'call' else N(d1) - 1

def theta(s, X, T, r, sigma, typ='call'):
    d1 = (math.log(s/X) + (r + sigma**2/2)*T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if typ == 'call':
        theta = -s * stats.norm.pdf(d1, 0, 1) * sigma / (2 * math.sqrt(T)) - r * X * math.exp(-r * T) * N(d2)
    elif typ == 'put':
        theta = -s * stats.norm.pdf(d1, 0, 1) * sigma / (2 * math.sqrt(T)) + r * X * math.exp(-r * T) * N(-d2)
    return theta / 365

def vega(s, X, T, r, sigma):
    d1 = (math.log(s/X) + (r + sigma**2/2)*T) / (sigma * math.sqrt(T))
    return s * stats.norm.pdf(d1, 0, 1) * math.sqrt(T)

def black_scholes(s, X, T, r, sigma, typ='call'):
    d1 = (math.log(s/X) + (r + sigma**2/2)*T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    price = s * N(d1) - X * math.exp(-r*T) * N(d2)
    if typ == 'call':
        return price
    if typ == 'put':
        price = price - s + X * math.exp(-r*T)  # put-call parity relationship
        return price

@app.get('/pricing/')
def calculate(t: str, s: float, x: float, e: int, iv: float, r: float):
    return {
        'price': round(black_scholes(s, x, e/365, r, iv, typ=t), 2),
        'delta': round(delta(s, x, e/365, r, iv, typ=t), 4),
        'theta': round(theta(s, x, e/365, r, iv, typ=t), 4),
        'vega': round(vega(s, x, e/365, r, iv), 2),
    }

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
    data = data[:-1] if trading else data
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

def get_iv(tk: str):
    data = get_option_list(tk, ret='iv')
    cls = '🔴' if data['iv'] > data['hv'] else '🟢'
    res = {   
            'cls': cls,
            'value': f'{round(data['iv']*100, 1)}%',
            'supp': [{'cls': '🔴' if cls == '🟢' else '🟢', 'val': f'HV {round(data['hv']*100, 1)}%'}],
            'timestamp': data['timestamp'],
            'title': 'IV'
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

    capflow = get_capital_flow(tk)

    data = [
        {
            'cls': '🔴' if r < 0 else '🟢',
            'value': f'+{r}%' if r > 0 else f'{r}%',
            'supp': supp_pre,
            'title': 'pre',
        },
        {
            'cls': closes[0]['cls'],
            'value': closes[0]['val'],
            'supp': closes,
            'title': 'hist.'
        },
    ]
    data = [capflow] + data + [get_iv(tk)]
    return data
# ------------------------
# place order
# ------------------------
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


side = {'buy': OrderSide.Buy, 'sell': OrderSide.Sell}

class Order(BaseModel):
    id: str | None = None
    symbol: str | None  = None
    side: str = 'buy'
    price: Decimal
    qty: int

@app.post("/order")
def place_order(order: Order):
    response = tr.submit_order(symbol=order.symbol, 
                               order_type=OrderType.LO,
                               side=side[order.side],
                               submitted_quantity=order.qty,
                               time_in_force=TimeInForceType.Day,
                               submitted_price= order.price,
                                )
    detail = tr.order_detail(response.order_id)
    return {'id': response.order_id, 'status': str(detail.status)}

@app.post('/replace')
async def replace_order(order: Order):
    tr.replace_order(order_id=order.id, quantity=order.qty, price=order.price)
    return 1

@app.get("/cancel")
def cancel_order(id: str):
    tr.cancel_order(id)
    return 1

@app.get('/status/')
def get_status(id):
    detail = tr.order_detail(id)
    return str(detail.status)

@app.get('/positions')
def get_positions():
    if (not trading) and positions['val']:
        return positions['val']
    res = tr.stock_positions().channels[0].positions 
    lst = [
        {
        'symbol': i.symbol, 
        'cost': i.cost_price,
        'qty': i.quantity,
        } 
        for i in res]
    # parse_symbol output
    # 'tk': tk.lower(),
    # 'type': t.lower(),
    # 'eidx': eidx,
    # 'strike': strike, 
    # 'name': name
    parsed = [parse_symbol(i['symbol'], parts=True) for i in lst]
    prices = q.option_quote([i['symbol'] for i in lst])
    prices = [i.last_done for i in prices]
    pls = [(prices[i] - lst[i]['cost']) * lst[i]['qty']*100 for i in range(len(lst))]

    out = [{**d, **p, 'price': i, 'pl': j} for d, p, i, j in zip(lst, parsed, prices, pls)]

    if not trading:
        positions['val'] = out

    return out


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8080)