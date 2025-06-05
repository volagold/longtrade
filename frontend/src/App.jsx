import { useEffect, useState, useRef } from 'react'
import { motion } from "framer-motion"
import 'remixicon/fonts/remixicon.css'
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
// import confetti from 'canvas-confetti';

const trading = true
const soundCash = new Audio("cash.mp3")
const soundPop = new Audio("success.mp3")
const soundError = new Audio("error.mp3")

const currentYear = new Date().getFullYear();
axios.defaults.baseURL = 'http://localhost:8080'

const useInterval = (callback, delay) => {
  const savedCallback = useRef();
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    function tick() {
      savedCallback.current();
    }
    if (delay !== null) {
      let id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

const factors_template = [
  {   
      'cls': '⚪️', 
      'value': 0, 
      'title': 'cap'
   },
  {
      'cls': '⚪️',
      'value': 0,
      'supp': [],
      'title': 'pre',
  },
  {
      'cls': '⚪️',
      'value': 0,
      'supp': [],
      'title': 'hist.'
  },
  {
      'cls': '⚪️',
      'value': '0%',
      'title': 'iv'
  },
]

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function App() {
  const line = 1200
  const [dark, setDark] = useState(mediaQuery.matches)
  const [hide, setHide] = useState(true)
  const [factors, setFactors] = useState(factors_template)  //  Array of {cls, value, supp, title}
  const [board, setBoard] = useState([])
  const [showBoard, setShowBoard] = useState(false)
  // states per tk
  const [idx, setIdx] = useState(0)
  const [tk, setTk] = useState('tsla')
  const [ws, setWS] = useState(null)
  const [stat, setStat] = useState({prevClose: 0, max: 0, min: 0})

  const theme = !dark? 'fantasy' : 'luxury';  // dim
  document.querySelector('html').setAttribute('data-theme', theme);

  const get_capflow = async (ticket) => {
    const res = await axios.get(`/capflow/?tk=${ticket}`);
    if (res.status == 200){
      setFactors(prevArray => {
        const newArray = [...prevArray];
        newArray[0] = res.data;
        return newArray;
      })
    }
  }

  const quote = () => {
    if (ws){ ws.close() }
    const socket = new WebSocket("ws://localhost:8080/quote");
    setWS(socket);
    socket.onopen = () => {
      toast.success('Successfully subscribed to all tickets.')
    }
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setBoard(data.data)
    };
    socket.onerror = (error) => {
      console.error("ws error: ", error)
      toast.error('Something went wrong')
      soundError.play()
    };
    socket.onclose = (event) => {
      console.log("ws closed: ", event)
    };
    return () => { socket.close() }
  }

  const handleTkClick = async (ticket, idx) => {
    setTk(ticket)
    setIdx(idx)
    setShowBoard(false)
    // get stat
    const res_stat = await axios.get(`/stat/?tk=${ticket}`)
    setStat(res_stat.data)
    // get factors
    const res_f = await axios.get(`/factors/?tk=${ticket}`);
    setFactors(res_f.data)
  }

  // when developing frontend
  const quotetest = () => {
    const fakedata = [
      {"tk": 'tsla', "full_price": 262.670, "p": 20, "r": 5, "vol": 100, "mm": false},
      {"tk": 'aapl', "full_price": 230, "p": -10, "r": 5, "vol": 100, "mm": false},
      {"tk": 'meta', "full_price": 550, "p": -50, "r": 5, "vol": 100, "mm": false },
      {"tk": 'crwd', "full_price": 550, "p": -50, "r": 5, "vol": 100, "mm": false },
      {"tk": 'net', "full_price": 130, "p": -5.6, "r": 5, "vol": 100, "mm": false },
      {"tk": 'app', "full_price": 230, "p": -7, "r": 5, "vol": 100, "mm": false },
      {"tk": 'pltr', "full_price": 80, "p": -0.2, "r": 5, "vol": 100, "mm": false },
    ]
    setBoard(fakedata)
  }

  // quote on load
  useEffect(() => {
    quote()
    // quotetest()
  }, [])

  // upadte capflow regularly
  if (trading){useInterval(() => get_capflow(tk), 60 * 1000)}

  // update max and min on market opening
  useEffect(() => {
    const open = new Date(); 
    open.setHours(21, 30, 5); // local time to update, i.e. 09:30pm or 10:30pm
    const now = new Date();
    const diff = open.getTime() - now.getTime();
    if (diff > 0) {
      const timeoutId = setTimeout(() => {
        (async () => {
          const res = await axios.get(`/stat/?tk=${tk}`)
          setStat(res.data)
            })()
      }, diff);
      return () => clearTimeout(timeoutId);
    }
  }, [tk])

  // Esc key listener
  // useEffect(() => {
  //   const hide = (event) => {
  //     if (event.key === 'Escape') { setShowOrder(false) }
  //   };
  //   window.addEventListener('keydown', hide);
  //   return () => { window.removeEventListener('keydown', hide) };
  // }, [])
  
  // const maxColor = dark? '#00b500' : '#7efda0'
  // const minColor = dark? '#a00' : '#ff99a5'

  return (
  <>
  <div className='mt-2 flex flex-col items-center justify-center'>
  {/* header start */}
  <div className="w-screen p-2 border-y-4 font-semibold text-2xl flex flex-row items-center bg-base-100 border-primary overflow-visible">
    {/* clock */}
    < i className="ri-time-line mr-1"></i> <Clock/>
    {/* ticket/price list */}
    <div className={`ml-2`}>
      <button className="btn text-2xl text-center" onClick={()=>setShowBoard(prev => !prev)}>{tk.toUpperCase()} <i className="ri-arrow-down-s-fill"></i></button>
      {showBoard && board.length > 0 &&
      <ul className="absolute top-20 card list bg-base-100 z-10 w-max text-2xl font-mono font-bold border-2">
      {board.map((item, idx) => {
      return (
        <li
        key={idx}
        className={`list-row cursor-pointer hover:bg-base-300 ${item.p > 0? 'text-green-600' : 'text-red-600'}`}
        onClick={()=>handleTkClick(item.tk, idx)}
        >
          <div className='w-20'>{item.tk.toUpperCase()}</div>
          <div className='w-32'>${item.full_price.toFixed(2)}</div>  
          <div className='w-28'>{item.p>0? '+' : null}{item.p}</div>
          <div className='w-24'>{Intl.NumberFormat('en-US', {notation: "compact", maximumFractionDigits: 1}).format(item.vol)}</div> 
        </li>
      )})}
      </ul>
      }
    </div>

    {/* price quote */}
    {board.length > 0 &&
      <div className={`ml-5 flex flex-row w-[220px] gap-2 text-3xl italic ${board[idx].p > 0? 'text-green-600' : 'text-red-600'}`}>
        <div className='w-[130px]'>${board[idx].full_price.toFixed(2)}</div>
        <div className='w-[90px]'>{board[idx].p>0? '+' : ''}{board[idx].p.toFixed(2)}</div>
      </div>
    }

    {/* factors */}
    <div className='ml-4 mr-1'><Factors data={factors}/></div>
    
    {/* light/dark theme */}
    <ThemeButton systemDark={mediaQuery.matches} callback={setDark} />
    <div className="divider divider-horizontal divider-primary"></div>
    {/* hide/show price plot */}
    <div className='ml-2 text-4xl cursor-pointer' onClick={()=>setHide(prev =>!prev)}>{hide? <i className="ri-eye-line"/> : <i className="ri-eye-off-fill"/>} </div>
  </div>
  {/* header end */}

    {/* Real-time price plot */}
    {!hide && board.length > 0 && 
      <Plot 
      val={board[idx].p} 
      resist={board[idx].r} 
      vol={board[idx].vol}
      stat={stat} 
      len={line}
      dark={dark}/>
    }

  {/* option pricing/quote/order */}
  {board.length > 0 &&  <Pricing key={tk} tk={tk} s={board[idx].full_price} dark={dark}/> }
  
  {/* main body div end */}
  </div>

  <Toaster 
  position="top-center"
  containerClassName=""
  toastOptions={{
    className: 'text-2xl font-mono',
    // duration: 4000,
  }}
  />
  </>
  )
}

// plot real time stock quote
function Plot({val, resist, vol, stat, len, dark}){
  stat.max = Math.max(val, stat.max)
  stat.min = Math.min(val, stat.min)

  const vis_resist = (r) => {
    let color, ripp, freq;
    if (r <= 1){
      color = {main:'#b3b3b3', main2:'#ccc', main3: '#f8fcff', ripp:'#b3b3b3'}; ripp = 5.2; freq = 1.5
    } if (1 < r && r <= 5){
      color = {main:'#61ff4d', main2:'#c1ffc1', main3: '#e1ffdd', ripp:'#e1ffdd'}; ripp = 5.6; freq = 1.5
    } if (5 < r && r <= 15){
      color = {main:'#ff7d00', main2:'#fb9a40', main3: '#f9cd85', ripp:'#f9cd85'}; ripp = 6; freq = 1.1
    }  if (15 < r && r <= 25){
      color = {main:'#ff7d00', main2:'#fb9a40', main3: '#f9cd85', ripp:'#f9cd85'}; ripp = 6.5; freq=0.9
    } if (r > 25){
      color = {main:'#fb0007', main2:'#fc7169', main3: '#fda6ad', ripp:'#fd978a'}; ripp = 7; freq=0.65
    }
    return [color, ripp, freq]
  }
  const [color, ripp, freq] = vis_resist(resist);
  const x1 = 10
  const mid = len / 2
  const mm = (len / 2) - 90
  const box = {
    svh: 200,
    h: 65,
    rx: 35,
    dash: dark? "9, 6" : "9, 4",
    stroke: dark? "#e6e6e6" : "black",
    strokewidth: 5,
    strokePrice: val > 0 ? "green" : "#d0000b",
    strokewidthPrice: 20,
    mkview: 20,
    mksize: 5,
    mk_offset: val > 0 ? 8 : 15,
    prevColor: dark? "#fff" : "black",
    priceColor: dark? "#fff" : "black",
    volumeColor: dark? "#dae1e2" : "#3e0000",
    maxstrokeWidth: 10,
    minstrokeWidth: 10,
    maxStroke: dark? "#959cad" : "gray",
    minStroke: dark? "#959cad" : "gray",
    maxTextColor: dark? "#959cad" : "gray",
    minTextColor: dark? "#959cad" : "gray",
    maxminfontSize: 24,
    strikePriceColor: dark? "#ccc" : '#5055ff',
    optionTextColor: dark? "#959cad" : "gray",
    optFontsize: 20,
    callInfoLoc: mid+90,
    putInfoLoc: mid-510,
  }
  const scale = 30  // Math.abs(val) <= (mid - box.rx/2)/30 ? 30 : 15
  const floor = (x) => Math.max(Math.min(x, mm), -mm)

  return (
  <div className='mt-5'>
  <motion.svg width={len+40} height={box.svh}>
    <motion.marker
      id="dot" viewBox={`0 0 ${box.mkview} ${box.mkview}`}
      refX={box.mk_offset} refY={box.mkview/2} markerWidth={box.mksize} markerHeight={box.mksize}
    >
      <motion.circle 
        animate={{r: [ripp, ripp*1.2], opacity: [1, 0]}}
        transition={{duration: freq, ease: "linear", repeat: Infinity}}
        cx={box.mkview/2} cy={box.mkview/2} fill={color.ripp}
      />
      <motion.circle  cx={box.mkview/2} cy={box.mkview/2} r={5} fill={color.main3} opacity={1} />
      <motion.circle cx={box.mkview/2} cy={box.mkview/2} r={4.3} fill={color.main2} opacity={1} />
      <motion.circle cx={box.mkview/2} cy={box.mkview/2} r={3.5} fill={color.main} opacity={1} />
    </motion.marker>

    <motion.rect  // X-axis
    x={x1} y={box.svh/4} width={x1+len} height={box.h} rx={box.rx} 
    fill="none" stroke={box.stroke} strokeWidth={box.strokewidth} 
    // strokeDasharray={box.dash}
    />

    <motion.line  // Stock Price
    animate={{x2: mid + floor(val*scale)}}  // scale a little bit
    transition={{ type: "spring" }}
    x1={mid} y1={(box.svh/4) + (box.h/2)} x2={mid} y2={(box.svh/4) + (box.h/2)} 
    stroke={box.strokePrice} 
    strokeWidth={box.strokewidthPrice} 
    strokeLinecap="round" opacity={1}
    markerEnd="url(#dot)"
    >
    </motion.line>

  <motion.line  // max line
    animate={{ opacity: [1, 0.3]}}  
    transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse"}}
    x1={mid+floor(stat.max*scale)} y1={box.h} x2={mid+floor(stat.max*scale)} y2={box.h*1.5} 
    stroke={box.maxStroke} 
    strokeWidth={box.maxstrokeWidth} 
    strokeLinecap="round" opacity={1}
    ></motion.line>

    <motion.line  // min line
    animate={{ opacity: [1, 0.3]}}  
    transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse"}}
    x1={mid+floor(stat.min*scale)} y1={box.h} x2={mid+floor(stat.min*scale)} y2={box.h*1.5} 
    stroke={box.minStroke} 
    strokeWidth={box.minstrokeWidth} 
    strokeLinecap="round" opacity={1}
    ></motion.line>

    <motion.text  // stock volume
      x={20} y={box.h*2.2} 
      fontSize={26} 
      fontWeight={"bold"}
      fill={box.volumeColor} 
      opacity={1}
    >
    𝚫vol={Intl.NumberFormat('en-US', {notation: "compact", maximumFractionDigits: 1
    }).format(vol)}
    </motion.text>
    
    <motion.text // previous close
      x={mid-20} y={box.svh/6} 
      fontSize={28} 
      fontWeight={"bold"}
      fill={box.prevColor} 
      opacity={1}
    >
      ${stat.prevClose}
    </motion.text>

    <motion.text // max text
      x={mid+floor(stat.max*scale)+10} y={box.h*1.4} 
      fontSize={box.maxminfontSize} 
      fill={box.maxTextColor} 
      fontWeight={"bold"}
      opacity={0.9}
    >
      max {stat.max}
    </motion.text>

    <motion.text // min text
      x={mid+floor(stat.min*scale)-140} y={box.h*1.4} 
      fontSize={box.maxminfontSize} 
      fill={box.minTextColor} 
      fontWeight={"bold"}
      opacity={0.9}
    >
      min {stat.min}
    </motion.text>

    <motion.text // price text (- prevClose)
      x={mid+floor(val*scale) + Math.sign(val)*box.mk_offset} 
      y={(box.svh/2) + box.h} 
      fontSize={32} 
      fontWeight={"bold"}
      fill={box.priceColor}
    >
    {val > 0? "+" : null}{val}
    </motion.text>
  </motion.svg>
  </div>
  )
}

function Factors({data}){
  const size = 50
  const color = {
    '🔴': {main:'#ff153a', second:'#ff7869'},
    '⚪️': {main:'#b3b3b3', second:'#d4d2d9'},
    '🟢': {main:'#00d600', second:'#43ff68'},
  }

  return (
    <div className='flex flex-row gap-5'>
      {data.map(item => {
        return (
        <div 
        key={item.title} 
        className='w-min relative group flex flex-row gap-2 items-center'
        >
          {/* Timestamp */}
          {item.timestamp? <div className='absolute top-full text-3xl w-max rounded-lg bg-secondary text-secondary-content p-4 font-mono font-bold hidden group-hover:block'>{item.timestamp}</div> : null}
          
          {/* Circle */}
          <motion.svg width={size} height={size}>
            <motion.circle 
            animate={{r: [15, 25], opacity: [1, 0]}}
            transition={{duration: 2.2, repeat: Infinity}}
            cx={size/2} cy={size/2} fill={color[item.cls].second} 
            />
            <motion.circle cx={size/2} cy={size/2} r={15} fill={color[item.cls].main}/>
          </motion.svg>

          {/* (Dropdown if supp on) Title */}
          {item.supp? 
          <div className="dropdown">
          <div tabIndex="0" role="button" className="text-2xl font-bold btn w-[60px]">{item.title}</div>
          <ul tabIndex="0" className="dropdown-content menu justify-center items-start bg-base-100 rounded-box z-1 w-max shadow-sm text-2xl font-mono font-bold">
            {item.supp.map((x, idx) => {
              return (
                <li key={idx} className={x.cls == '🟢'? 'text-green-600': 'text-red-600'}>
                  <span><pre>●&nbsp;{x.val}</pre></span>
                </li>
              )
            })}
          </ul>
          </div>
          
        : <span className='w-[60px] text-2xl font-bold'>{item.title}</span> }

        {/* Value */}
        <span className='text-2xl font-mono'>{item.value}</span>    

      </div>
        )
      })}
    </div>
  )
}

// in the frontend, order obj means response returned by the backend 
// function OrderCard({order, setshow}){
//   return (
//   <div className="card bg-base-100 text-nowrap shadow-xl">
//     <div className="card-body">
//       <div className='flex flex-row gap-2 text-2xl'>
//         <i className="ri-checkbox-circle-line text-2xl text-green-500"></i>
//         <h2>{order.name}</h2>
//       </div>
      
//       <table className='table text-2xl'>
//       <tr> <th>status:</th> <td>{order.status}</td></tr>
//       <tr><th>side:</th><td>{order.side}</td> </tr> 
//       <tr><th>qty:</th> <td>{order.qty}</td></tr>
//       <tr><th>price:</th> <td>{order.exec_price}</td></tr>
//       {order.side == 'buy' && <tr className='text-red-600'><th>cost:</th> <td>{order.totalCost}</td></tr>}
//       {order.side == 'sell' && <tr className={order.profit > 0? 'text-green-600' : 'text-red-600'}><th>profit:</th> <td>${order.profit} {order.profit > 0? '🎉🎉🎉' : ''}</td></tr>}
//       <tr><th>time:</th> <td>{order.time}</td></tr>
//       </table>
      
//       <button  
//       className="btn btn-outline btn-success text-lg font-mono mt-2"
//       onClick={()=>setshow(false)}
//       >
//         Close
//       </button>
//     </div>
//   </div>
//   )
// }

function Pricing({tk, s, dark}) {
  const [type, setType] = useState('put') // put or call
  const [bsprice, setBSprice] = useState(null) // custom s input
  const [bsT, setBST] = useState(null) // custom T inpput
  const [iT, setIT] = useState(0) // expiration index
  const [T, setT] = useState(1) // expiration (in days)
  const [X, setX] = useState(0) // strike
  const [r, setR] = useState(0.043) // interest rate
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [dates, setDates] = useState([]) // expiration list
  const [strikes, setStrikes] = useState([]) // strike table
  const [selected, setSelected] = useState(-1) // selected option chain table row idx
  const [iv, setIv] = useState(0.6)
  const [result, setResult] = useState({})
  // orders & positions
  const [pos, setPos] = useState(true) // position tab selected?
  const [positions, setPositions] = useState([])
  // const [positions, setPositions] = useState([
  //   {symbol:'', name: 'AAPL💰03/21💰150 Put', price:13.0, cost:1.0, qty:1, pl: 1200},
  //   {symbol:'', name: 'META💰03/21💰330 Put', price:6.5, cost:0.5, qty:1, pl: 600}
  // ])
  const [orders, setOrders] = useState([
    {id: '111', symbol:'', name: 'TSLA💰03/21💰210 Put', price: 1.5, qty:1, status: 'pending'},
    {id: '222', symbol:'', name: 'META💰03/21💰330 Put', price: 0.4, qty:1, status: 'filled'}
  ])
  const wsStrike = useRef(null);
  const wsDepth = useRef(null);
  const [depth, setDepth] = useState(
    {bid: {p: '--', q:'--'}, ask: {p: '--', q: '--'} }
  )

  // place order
  const [price, setPrice] = useState(0.01)  // order price
  const [qty, setQty] = useState(1)  // order quantity
  const [loading, setLoading] = useState(false)

  let moneyness
  if (type == 'put' && X-s < 0){
    moneyness = 'otm'
  } if (type == 'put' && X-s >= 0){
    moneyness = 'itm'
  }if (type == 'call' && X-s > 0){
    moneyness = 'otm'
  } if (type == 'call' && X-s <= 0){
    moneyness = 'itm'
  }

  const quoteDepth = (symbol) => {
    if (wsDepth.current){
      wsDepth.current.close()
    }
    const socket = new WebSocket("ws://localhost:8080/quote-depth");
    wsDepth.current = socket
    socket.onopen = () => {socket.send(symbol)};
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setDepth(data.data)
    };
    socket.onerror = (error) => {console.error("ws error: ", error)};
    socket.onclose = (event) => {console.log("ws closed: ", event)};
    return () => socket.close()
  }

  const quoteStrikes = () => {
    if (wsStrike.current){
      wsStrike.current.close()
    }
    const socket = new WebSocket("ws://localhost:8080/quote-strikes");
    wsStrike.current = socket
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setStrikes(data.data)
    };
    socket.onerror = (error) => {console.error("ws error: ", error)};
    socket.onclose = (event) => {console.log("ws closed: ", event)};
    return () => socket.close()
  }

  const calculate = async (type, s, T, X, iv, r) => {
    try{
      const res = await axios.get(`/pricing/?t=${type}&s=${s}&e=${T}&x=${X}&iv=${iv}&r=${r}`)
      setResult(res.data)
      setPrice(res.data.price)
    } catch {
      toast.error('check your entry')
      soundError.play()
    }
  }

  const getdates = async (tk) => {
    const res = await axios.get(`/dates/?tk=${tk}`)
    setDates(res.data)
    setT(res.data[0][1])
  }

  const handleExpClick = (item, idx)=> {
    setIT(idx)
    setT(item[1])
    setSelected(-1)
    getstrikes(idx, tk=tk) 
  }

  const getstrikes = async (idx, tk=tk, t=type) => {
    const res = await axios.get(
      `/strikes/?tk=${tk}&type=${t}&eidx=${idx}&quote=${true}&num=20`
    )
    setStrikes(res.data)
    if (trading) { 
      quoteStrikes()
    }
  }

  const handleStrikeClick = (item, idx)=>{
    setSelected(idx)
    setSymbol(item.symbol)
    setName(item.name)
    setX(item.strike)
    setIv(item.iv)
    calculate(type, s, T, item.strike, item.iv>0? item.iv : iv, r)
    quoteDepth(item.symbol)
  }

  const getPositions = async () => {
    const res = await axios.get('/positions')
    setPositions(res.data)
  }

  const handlePositionClick = (item) => {
    setSymbol(item.symbol)
    setName(item.name)
    setType(item.type)
    setT(item.T)
    quoteDepth(item.symbol)
  }

  const handleOrderClick = (item) => {
    setSymbol(item.symbol)
    setName(item.name)
    quoteDepth(item.symbol)
  }

  const handleTypeClick = (t) => {
    if (t != type){
    setType(t)
    setSelected(-1)
    getstrikes(iT, tk=tk, t=t)
    }
  }

  // const getStatus = async (id) => {
  //   // todo
  //   const res = await axios.get(`/status/?id=${id}`)
  // }

  const placeOrder = async (side) => {
    try{
    setLoading(true);
    const res = await axios.post('/order', {
      symbol: symbol,
      side: side,
      price: price,
      qty: qty,
    })
    setOrders([
      {id: res.data.id,
       symbol: symbol, name: name, price: price, qty: qty, 
       status: res.data.status},
      ...orders
    ])
    soundPop.play()

  } catch(error) {
    if (error.response) {
      console.error('error status:', error.response.status);
      console.error('error data:', error.response.data);
  } else if (error.request) {
      console.error('no response received:', error.request);
  } else {
    console.error('error message:', error.message);
  }
  } finally {
    setLoading(false)
  }
  }

  const replaceOrder = async (formData) => {
    try{
      res = await axios.post('/replace', {
        id: formData.get('id'),
        price: formData.get('price'),
        qty: formData.get('qty')
      })
      toast.success('order updated')
      soundPop.play()
  } catch (err){
    toast.error(err.message)
    soundError.play()
  }
  }

  const cancelOrder = async (id) => {
    try{
      await axios.get(`/cancel/?id=${id}`)
      toast.success('order canceled')
    } catch (err) {
      toast.error(err.message)
      soundError.play()
    }
  }

  useEffect(() => {
    getdates(tk)
    getstrikes(0, tk, type)
  }, [])

  return (
    <>
    {/* T - [chain - pricing - order] */}
    <div className='mt-5 flex flex-col gap-2'>
    
    {/* expiration (T) */}
    <div className='ml-10 w-screen flex flex-row gap-4 items-center overflow-scroll'> 
        {dates.map((item, idx) => {
          return (
            <div key={idx} className='min-w-20 cursor-pointer' onClick={()=>handleExpClick(item, idx)}>
                <div className={`${item[1] == T? 'text-primary text-xl' : ''} font-bold text-gray-400 flex flex-col`}>
                  <span className='text-lg w-24'>{item[0].startsWith(currentYear) ? item[0].slice(5) : item[0].slice(2)}</span>
                  <span>{item[1]}d</span>
                </div>
              </div>
          )
        })}
    </div>
    {/* I.Strike, II.Result and III.Order */}
    <div className='flex flex-row gap-2'>
    {/* I. Strike price (X) */}
      <div className='ml-10 h-[800px] w-[500px] overflow-scroll'>
        <table className="table table-zebra table-pin-rows">
          {/* head */}
          <thead>
            <tr className='text-lg'>
              <th className="bg-primary text-primary-content rounded-tl-lg">Strike</th>
              <th className="bg-primary text-primary-content">min</th>
              <th className="bg-primary text-primary-content">price</th>
              <th className="bg-primary text-primary-content">max</th>
              <th className="bg-primary text-primary-content">𝚫</th>
              <th className="bg-primary text-primary-content">iv</th>
              <th className="bg-primary text-primary-content">vol</th>
              <th className="bg-primary text-primary-content rounded-tr-lg">open</th>
            </tr>
          </thead>
          <tbody>
          {strikes.map((item, idx) => {
          return (
          <tr key={idx} className={`${selected == idx? 'border-y-4 border-primary font-bold italic text-2xl' : 'text-lg font-semibold'} cursor-pointer h-min py-0`} onClick={()=>handleStrikeClick(item, idx)}>
            <td className='bg-base-100 text-xl font-bold'>{item.strike}</td>
            <td className='w-[50px]'>{item.min}</td>
            <td className={`${item.ch > 0? 'text-success':'text-error'} w-[50px]`}>{item.p}</td>
            <td className='w-[50px]'>{item.max}</td>
            <td className={`${item.ch > 0? 'text-success':'text-error'} w-[50px]`}>{item.ch}</td>
            <td className='w-[50px]'>{item.iv}</td>
            <td className='w-[50px]'>{item.vol}</td>
            <td className='w-[50px]'>{item.openInterest}</td>
          </tr>
        )
      })}
        </tbody>
        </table>
      </div>
    {/* Strike price end */}

    {/* II. Pricing result panel */}
    <div className={`relative h-min w-[410px] mt-2 px-4 py-10 ml-2 border-4 rounded-xl border-primary flex flex-col gap-2 items-center bg-linear-to-t ${type=='put'? !dark? 'from-purple-300' : 'from-orange-300' : 'from-green-300'} from-1% to-30%`}>
      {/* display symbol/name */}
      <div className='absolute left-3 top-3 font-bold text-xl'>{name}</div>
      {/* put/call selection */}
      <div className="join join-horizontal absolute right-3 top-3">
        <input type="radio" className="join-item btn bg-orange-500 text-gray-100 text-lg" name="order_type" aria-label="put" onClick={()=>handleTypeClick('put')} defaultChecked/>
        <input type="radio" className="join-item btn bg-green-500 text-gray-100 text-lg" name="order_type" aria-label="call" onClick={()=>handleTypeClick('call')} />
      </div>
      {/* pricing result display */}
      <div className='min-h-60 w-44 flex flex-col gap-2 justify-center items-center'>
        {result.price>=0? 
          <>
            <div className='relative'>
              <div className={`absolute right-[110%] top-1/3 ml-5 badge badge-xl font-bold ${moneyness=='itm'? 'badge-success' : 'badge-primary'}`}>{moneyness}</div>
              <div className='my-5 text-5xl font-bold text-primary'>${result.price}</div>
            </div>
            <div className='text-3xl italic w-max font-mono'>X-s = {(X - s).toFixed(2)}, T={bsT? bsT : T}d</div>
            <div className='text-2xl italic w-max font-mono'>𝛅 = {result.delta}</div>
            <div className='text-2xl italic w-max font-mono'>𝝷 = {result.theta}</div>
            <div className='text-2xl italic w-max font-mono'>ν = {result.vega}</div>
          </>  : <div className='text-5xl font-bold italic text-amber-300 items-center'>Pricing</div> }
      </div>
      {/* parameter adjustment section */}
      <div className='flex flex-col text-2xl gap-2'>
            
      {/* stock price and date */}
      <div className='flex flex-row items-center gap-2'>
        {/* custom stock price */}
        <span className='w-12'>S</span>
        <input type="text" placeholder='stock price' className="input input-xl text-2xl font-mono border-b-4 border-b-secondary" value={bsprice} onChange={(e)=>setBSprice(e.target.value)}/>
        {/* custom date */}
        <span>T</span>
        <input type="text" placeholder='T' className="input text-2xl w-20 font-mono border-b-4 border-b-secondary" value={bsT} onChange={(e)=>setBST(e.target.value)}/>
      </div>
      {/* strike price */}
      <div className='flex flex-row items-center'>
        <span className='w-12'>X</span>
        <input type="text" placeholder='strike' className="input input-xl text-3xl text-primary font-mono font-bold border-b-4 border-b-secondary" value={X} onChange={(e)=>setX(e.target.value)}/>
      </div>
      {/* volatility (𝜎) */}
      <div className='flex flex-row items-center'>
        <span className='w-12'>𝝈</span>
        <input type="text" placeholder='volatility' className="input input-xl text-3xl font-mono border-b-4 border-b-secondary" value={iv} onChange={(e)=>setIv(e.target.value)}/>
      </div>
      {/* interest rate (r) */}
      <div className='flex flex-row items-center'>
        <span className='w-12'>r</span>
        <input type="text" placeholder='interest rate' className="input input-xl text-2xl font-mono border-b-4 border-b-secondary" value={r} onChange={(e)=>setR(e.target.value)}/>
      </div>

      </div>
      {/* parameter adjustment section end */}

      {/* calculate button */}
      <button className='mt-4 btn w-5/6 btn-xl' onClick={()=>{
        calculate(type, bsprice? bsprice : s, bsT? bsT : T, X, iv, r)
      }}>
      Calculate
      </button>
    
    </div>
    {/* Pricing result panel end */}

    {/* III. Order Component */}
    <div className='flex flex-col items-center'>

      {/* Positions and Orders  */}
      <div className='flex flex-row gap-2 w-full'>
        {/* tab */}
        <div className='join join-vertical'>
          <input type="radio" className="join-item btn text-lg w-12 h-16" name="pos_ord" aria-label="pos." onClick={
            ()=>{
              setPos(true)
              getPositions()
            }}
          defaultChecked/>
          <input type="radio" className="join-item btn text-lg w-12 h-16" name="pos_ord" aria-label="ord." onClick={
            ()=>setPos(false)
          }
          />
        </div>

        {/* list */}
        <ul className="list bg-base-100 rounded-box shadow-md w-[500px] h-40 text-lg overflow-scroll">
          <li className="p-1 font-bold tracking-wide">{pos? 'Positions' : 'Pending Orders'}</li>
          {pos && positions.map((item, idx) => {
            return (
              <li key={idx} className="list-row cursor-pointer" onClick={()=>handlePositionClick(item)}>
                <div className='font-bold w-max'>{item.name}</div>
                <div className='font-bold w-max'>({item.price}−{item.cost}) @{item.qty}</div>
                <div className='font-bold w-max'><span className={item.pl>0? 'badge badge-success': 'badge badge-error'}>P/L</span> <span className={item.pl>0? 'text-success': 'text-error'}>{item.pl>0? '+' : ''} ${item.pl}</span></div>
              </li>
            )})}
            {!pos && orders.map((item) => {
            return (
            <li key={item.id} className="list-row flex flex-row items-center w-max overflow-scroll">
              <div className='cursor-pointer' onClick={()=>cancelOrder(item.id)}><i className="ri-reset-left-line"></i></div>
              <div className='font-bold w-max' onClick={()=>handleOrderClick(item)}>{item.name}</div>
              <form className='flex flex-row items-center gap-1' action={replaceOrder}>
                <input type="hidden" name="id" value={item.id} />
                <input className='w-20 h-8 border-2 rounded-md' name='price' placeholder={item.price}/>
                <span>@</span>
                <input className='w-12 h-8 border-2 rounded-md' name='qty' placeholder={item.qty}/>
                <button type='submit' title='Change' className='ml-5 btn btn-square btn-outline btn-secondary text-green-600'><i className="ri-check-line"></i></button>
              </form>
            </li>
          )})}
        </ul>
      </div>
      {/* Orders & Positions end */}

      {/* real-ttme price display */}
      <VerticalProgressBar 
      quote={selected != -1 ? strikes[selected] : {min: s, p: s, max: s}}/>
      
      {/* depth display */}
      {/* depth */}
      <div className='flex flex-row mb-3'>
        <div className='flex flex-row gap-2 items-center w-60 h-14 border-y-2 border-y-success'>
          <span className='badge badge-success text-xl'>bid</span>
          <span className='text-3xl font-bold text-success'>${depth.bid.p}</span>
          <span className='text-lg ml-1'>⤫</span>
          <span className='text-lg'>{depth.bid.q}</span>
        </div>
        <div className='flex flex-row gap-2 items-center w-60 h-14 border-y-2 border-y-error'>
          <span className='badge badge-error text-xl'>ask</span>
          <span className='text-3xl font-bold text-error'>${depth.ask.p}</span>
          <span className='text-lg ml-1'>⤫</span>
          <span className='text-lg'>{depth.ask.q}</span>
        </div>

      </div>

      {/* order price and quantity */}
      <div className='flex flex-row gap-2'>
      <input type="text" placeholder='price' className="input w-56 h-12 font-mono font-bold text-xl" value={price} onChange={(e)=>setPrice(e.target.value)}/>
      <span className='text-3xl'>@</span>
      <input type="number" placeholder='qty.' className="input w-56 h-12 font-mono font-bold text-xl" value={qty} onChange={(e)=>setQty(e.target.value)} />
      </div>

      {/* buy and sell button */}
      <div className='mt-5 flex flex-row gap-2'>
      <TradeButton text='buy' callback={()=>placeOrder('buy')} disabled={loading}/> 
      <TradeButton text='sell' callback={()=>placeOrder('sell')} disabled={loading}/>
      </div>

    </div>

    </div>
    {/* I, II, III end */}
    </div>
    </>
  )
}

function VerticalProgressBar({quote}) {
  let percent = 50
  if (quote.max - quote.min >= 0.4){
    percent = (quote.p - quote.min) / (quote.max - quote.min) * 100
  }
  
  return (
    <div className="flex flex-row gap-2 my-5">
      {/* min/max */}
      <div className='flex flex-col justify-between font-bold'>
        <div className='flex flex-row gap-1.5'><span className='badge badge-primary text-lg'>max</span> <span className='text-xl'>${quote.max} －</span></div>
        <div className='flex flex-row gap-1.5'><span className='badge badge-primary text-lg'>min</span> <span className='text-xl'>${quote.min} －</span></div>
      </div>
      {/* bar */}
      <div className="relative w-8 h-60 bg-base-300 rounded-2xl overflow-hidden border-2 border-gray-400">
        <motion.div
          className="absolute bottom-0 w-full bg-primary"
          initial={{ height: 0 }}
          animate={{ height: `${percent}%` }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        />
      </div>
      {/* price */}
      <div className="relative h-60">
        <motion.div
          className="absolute bottom-0 w-full flex flex-row gap-1 text-2xl font-bold text-primary"
          initial={{ height: 0 }}
          animate={{ height: `${percent+6}%` }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <span className='text-3xl'>◀</span> ${quote.p}
        </motion.div>
      </div>
    </div>
  )
}

function TradeButton({text='buy', callback=null, disabled=false}) {
  return (
    <button
    className={`btn btn-outline w-60 h-16 text-2xl border-4 ${text=='buy'? 
      'bg-green-600' : 
      'bg-orange-600'}`
    }
    onClick={callback}
    disabled={disabled}
    >
      {text}
    </button>
  )
}

const Clock = () => {
  const [time, setTime] = useState(new Date());
  const options = { timeZone: 'America/New_York', hour12: false };
  
  useEffect(() => {
    const timerId = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timerId);
  }, []);

  return (
    <div className='font-bold text-3xl min-w-36'>
      {time.toLocaleTimeString('it-IT', options)}
    </div>
  );
};

function ThemeButton({systemDark, callback}){
  // source: https://daisyui.com/components/swap
  return (
    <label className="ml-5 swap swap-rotate">
      {/* this hidden checkbox controls the state */}
      <input type="checkbox" onClick={()=>callback(prev => !prev)}/>
      {/* sun icon */}
      <svg
        className={`${systemDark? 'swap-off' : 'swap-on'} h-12 w-12 fill-current`}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24">
        <path
          d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
      </svg>
      {/* moon icon */}
      <svg
        className={`${mediaQuery.matches? 'swap-on' : 'swap-off'} h-12 w-12 fill-current`}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24">
        <path
          d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z" />
      </svg>
    </label>
  )
}

export default App