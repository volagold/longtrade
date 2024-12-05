import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from "framer-motion"
import 'remixicon/fonts/remixicon.css'
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
import { ColorRing } from 'react-loader-spinner';
import confetti from 'canvas-confetti';


const soundCash = new Audio("cash.mp3")
const soundPop = new Audio("success.mp3")
const soundError = new Audio("error.mp3")

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

const factors_templ = [
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
      'cls': '⚪️',
      'value': 0,
      'supp': [],
      'title': 'pre-market',
  },
  {
      'cls': '⚪️',
      'value': 0,
      'supp': [],
      'title': 'prev.'
  },
  {
      'cls': '⚪️',
      'value': 'neutral',
      'title': 'mood'
  },
]

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function App() {
  const line = 1200
  const [dark, setDark] = useState(mediaQuery.matches)
  const [factors, setFactors] = useState(factors_templ)  //  Array of {cls, value, supp, title}
  const [board, setBoard] = useState([])
  const [isOpen, setIsopen] = useState(() => {
    const value = localStorage.getItem('isOpen');
    const array = value? JSON.parse(value): [];
    return array
  }) 

  // order strategy
  const [qty, setQty] = useState('min')
  const [money, setMoney] = useState('itm')
  const [orderType, setOrderType] = useState('MO')

  // states per tk
  const [idx, setIdx] = useState(0)
  const [tk, setTk] = useState('tsla')
  const [ws, setWS] = useState(null)
  const wsOption = useRef({put: null, call: null});
  const [stat, setStat] = useState({prevClose: 0, max: 0, min: 0})
  const [preview, setPreview] = useState([])
  const [previewSide, setPreviewSide] = useState('left')
  const [opt, setOpt] = useState({put:{}, call:{}})
  const [order, setOrder] = useState({put:{}, call:{}}) // latest order
  const [loading, setLoading] = useState(false) // show loading?
  const [showOrder, setShowOrder] = useState(false) // display order?
  const [left, setLeft] = useState(true) // place orderCard at left?

  const theme = !dark? 'cupcake' : 'forest';
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
  
  const get_corr = async (ticket) => {
      const res = await axios.get(`/corr/?tk=${ticket}`);
      if (res.status == 200){
        setFactors(prevArray => {
          const newArray = [...prevArray];
          newArray[1] = res.data;
          return newArray;
        })
      }
  }

  const make = async (tk, option, side) => {
    try{
    if (option == 'call'){ setLeft(false) }
    if (option == 'put'){ setLeft(true) }
    setLoading(true);
    const res = await axios.post('/order', {
      tk: tk,
      option: option,  // call or put
      side: side, // buy or sell
      order_type: orderType,
      qty: qty,
      money: money,
    })
    if (!res.data.success){ // no update to order, left states
      toast.error(res.data.message)
      soundError.play()
      return 
    }

    if (res.data.status == 'filled'){
      setOrder({...order, [option]: res.data})
      setShowOrder(true)
    } else {  // when sell & unfilled, don't want to disrupt DerivativePlot
      toast.custom((t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} card w-max bg-base-100 shadow-xl`}
        >
          <div className='card-body text-3xl flex flex-col gap-5'>
           
           <div className='w-max flex flex-row gap-2'>
              <i className="ri-information-2-line text-info font-bold"></i>
              <span>{res.data.message}</span>
           </div>
           
           <table className='table text-2xl'>
              <tr><th>status:</th> <td>{res.data.status}</td></tr>
              <tr><th>asset:</th> <td>{res.data.name}</td></tr>
              <tr><th>side:</th> <td>{res.data.side}</td></tr>
              <tr><th>qty:</th> <td>{res.data.qty}</td></tr>
           </table>
            <button className="btn mt-10 text-xl" onClick={() => toast.dismiss(t.id)}>
                <i class="ri-close-large-line"></i> Close
            </button>
        </div>
        </div>
      ), {duration: Infinity})
    }
   
    if (side == 'buy'){
      setIsopen(isOpen.concat(tk))
      soundPop.play()
      if (res.data.status == 'filled'){  // quote option only if buy order is filled 
        quoteOption(res.data.symbol, option)
      }
    }

    if (side == 'sell'){
      if (res.data.status == 'filled'){ // de-quote option only if sell order is filled
        setIsopen(isOpen.filter((item, idx) => idx !== isOpen.indexOf(tk)));
        wsOption.current[option].close();
        wsOption.current[option] = null;
        setOpt({...opt, [option]: {}});
      }
      if (res.data.profit > 0 ){
        confetti({  // celebration 🎉🎉🎉
          particleCount: 150,
          spread: 70,
          origin: { y: 0.7 }
        });
        soundCash.play();
      }
    }

  } catch(error) {
    if (error.response) {
      console.error('Error status:', error.response.status);
      console.error('Error data:', error.response.data);
  } else if (error.request) {
      console.error('No response received:', error.request);
  } else {
    console.error('Error message:', error.message);
  }
  } finally {
    setLoading(false)
  }
  }

  const quote = () => {
    if (ws){ ws.close() }
    const socket = new WebSocket("ws://localhost:8080/quote");
    setWS(socket);
    socket.onopen = () => {
      socket.send('Opened WebSocket from client side.');
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

  const quoteOption = (symbol, option) => {
    if (wsOption.current[option]){
      wsOption.current[option].close()
    }
    const socket = new WebSocket("ws://localhost:8080/quote-option");
    wsOption.current[option] = socket
    
    socket.onopen = () => {socket.send(symbol)};
    socket.onmessage = (event) => {
      const res = JSON.parse(event.data);
      setOpt(obj => {return {...obj, [option]: res}}); 
    };
    socket.onerror = (error) => {console.error("ws error: ", error)};
    socket.onclose = (event) => {console.log("ws closed: ", event)};
  }

  // What should happen when tk is clicked?
  const handleTkClick = async (ticket) => {    
    setTk(ticket);

    // get position
    const res_p = await axios.get(`/position/?tk=${ticket}`)
    const position = res_p.data; // {'put': last_put, 'call': last_call}
    setOrder(position); 

    // close existing option price quote when switching ticket
    if (wsOption.current.put){ wsOption.current.put.close() }
    if (wsOption.current.call){ wsOption.current.call.close() }
    wsOption.current = {put: null, call: null}
    setOpt({ put: {}, call: {} })

    // quote the derivative and profit if unclosed
    if (position.put.tk && position.put.status == 'filled'){  // position only returns buy order
      quoteOption(position.put.symbol, 'put') 
    }
    if (position.call.tk && position.call.status == 'filled'){  // position only returns buy order
      quoteOption(position.call.symbol, 'call') 
    }

    // update preClose, min, max
    const res_stat = await axios.get(`/stat/?tk=${ticket}`)
    setStat(res_stat.data)

    // get factors
    const res_f = await axios.get(`/factors/?tk=${ticket}`);
    setFactors(res_f.data)
    // capflow and corr
    await get_capflow(ticket)
    await get_corr(ticket)

    // sync with backend
    const serverCount = +!!(position.call.status == 'filled')+!!(position.put.status == 'filled')
    const localCount = isOpen.filter(x => x == ticket).length;
    const diff = localCount - serverCount    
    if (diff > 0){
      let arr = isOpen
      for (let i = 1; i <= diff; i++) {
        arr = arr.filter((item, idx) => idx !== arr.indexOf(ticket))
      }
      setIsopen(arr);
    }
    if (diff < 0){
      let arr = isOpen
      for (let i = 1; i <= -diff; i++) {
        arr = arr.concat(ticket)
      }
      setIsopen(arr);
    }
  }

  const handlePreview = async (ticket, option) => {
    const res = await axios.get(`/preview/?tk=${ticket}&typ=${option}`)
    setPreview(res.data)
    setPreviewSide(option == 'put'? 'left' : 'right')
  }

  // quote on load
  useEffect(() => {
    quote()
  }, [])

  // fade out preview
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreview([])
    }, 4500);
    return () => clearTimeout(timer);
  }, [preview])
  
  // upadte capflow and corr regularly
  useInterval(() => get_capflow(tk), 60 * 1000)
  useInterval(() => get_corr(tk), 5 * 60 * 1000)  // 1000ms => 1s

  // update max and min on market opening
  useEffect(() => {
    const open = new Date(); 
    open.setHours(22, 30, 5); // our local time to update, i.e. 09:30 PM or 10:30 PM
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

  // save isOpen to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('isOpen', JSON.stringify(isOpen));
  }, [isOpen])

  // Esc key listener
  useEffect(() => {
    const hide = (event) => {
      if (event.key === 'Escape') { setShowOrder(false) }
    };
    window.addEventListener('keydown', hide);
    return () => { window.removeEventListener('keydown', hide) };
  }, [])
  

  return (
  <>
  {/* top right button controls */}
  <div className='absolute top-1/3 right-1 2xl:right-[60px] mr-2 mt-2 flex flex-col gap-5 justify-center items-center'>
    <Clock/>
    <button className='btn btn-outline w-max rounded-full text-xl' 
            onClick={()=>setDark(prev => !prev)}>
      {dark? <i className="ri-sun-line"/> : 
             <i className="ri-moon-clear-line"/> }
    </button>
  </div>

  {/* Strategy */}
  <div className='absolute left-8 2xl:left-28 top-80 2xl:top-96 flex flex-col items-center gap-4'>
    {/* order_type. */}
    <div className='flex flex-col items-center'>
      <div className='font-bold text-lg'>typ.</div>
      <div className="join join-vertical w-12 border-2 border-primary">
        <input onClick={()=>setOrderType('LO')} className="join-item btn" type="radio" name="order_type" aria-label="LO"/>
        <input onClick={()=>setOrderType('MO')} className="join-item btn" type="radio" name="order_type" aria-label="MO" defaultChecked />
      </div>
    </div>
    {/* qty. */}
    <div className='flex flex-col items-center'>
      <div className='font-bold text-lg'>qty.</div>
      <div className="join join-vertical p-0 w-12 border-2 border-primary">
        <input onClick={()=>setQty('min')} className="join-item btn" type="radio" name="qty" aria-label="min" defaultChecked/>
        <input onClick={()=>setQty(2)} className="join-item btn" type="radio" name="qty" aria-label="2" />
        <input onClick={()=>setQty(3)} className="join-item btn" type="radio" name="qty" aria-label="3" />
        <input onClick={()=>setQty(4)} className="join-item btn" type="radio" name="qty" aria-label="4" />
        <input onClick={()=>setQty('max')} className="join-item btn" type="radio" name="qty" aria-label="max" />
        {/* <input onClick={()=>setQty('mmax')} className="join-item btn" type="radio" name="qty" aria-label="mmax" /> */}
      </div>
    </div>
    {/* moneyness. */}
    <div className='flex flex-col items-center'>
      <div className='font-bold text-lg'>strike</div>
      <div className="join join-vertical w-12 border-2 border-primary">
        <input onClick={()=>setMoney('itm')} className="join-item btn" type="radio" name="money" aria-label="ITM" defaultChecked/>
        <input onClick={()=>setMoney('otm')} className="join-item btn" type="radio" name="money" aria-label="OTM" />
      </div>
    </div>
  </div>
  
  <div className='mt-5 flex flex-col items-center justify-center'>
    {/* Price Board */}
    <AnimatePresence>
    <motion.div 
    key="board"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0}}
    transition={{ duration: 1.2, ease: 'easeInOut' }}
    className='grid grid-cols-8 2xl:grid-cols-9 gap-4 px-2'>
    {board.map((item, idx) => {
      return (
        <div key={idx} className='relative indicator cursor-pointer' onClick={() => {setIdx(idx); handleTkClick(item.tk)}}>
        
        {isOpen.includes(item.tk) && <span className="indicator-item badge badge-info"></span>}
        
        <StockBoard data={item} dark={dark}/>
        
        {item.tk == tk && <div className={`absolute ${dark? 'bg-blue-950' : 'bg-primary'} w-[176px] h-[84px] rounded-xl -z-10 top-[10px] right-[9px]`}></div>}
        </div>
      )})}
    </motion.div> 
    </AnimatePresence> 

    {/* Factors */}
    <Factors data={factors}/>

    {/* Real-time price plot */}
      {board.length > 0 && 
      <Plot 
      val={board[idx].p} 
      resist={board[idx].r} 
      vol={board[idx].vol}
      stat={stat} 
      len={line}
      opt={opt}
      dark={dark}/>
    }

    {/* Profit plot */}
    <AnimatePresence>
    {(opt.put.price > 0 && order.put.exec_price > 0) && 
    <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0}}
    transition={{ duration: 1.0 }}
    >
    <DerivativePlot key={order.put.id} opt={opt.put} order={order.put} len={line} />
    </motion.div>
    }
    </AnimatePresence>

    <AnimatePresence>
    {(opt.call.price > 0 && order.call.exec_price > 0) && 
    <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0}}
    transition={{ duration: 1.0 }}
    >
    <DerivativePlot key={order.call.id} opt={opt.call} order={order.call} len={line} />
    </motion.div>
    }
    </AnimatePresence>

    {/* Order button section */}
      <div className='relative flex flex-row gap-5 mb-16'> 
        {/* Put */}
        <div className='flex flex-col gap-4'>
          <TradeButton 
            type='close' 
            callback={()=>make(tk, 'put', 'sell')} // close position on tk
            disabled={loading}
          />
          <TradeButton 
            text={'Buy put 🔻'} 
            tk={tk}
            type='open'
            callback={()=>make(tk, 'put', 'buy')}  // est. long position on put
            disabled={loading}
          />
        </div>
        {/* Call */}
        <div className='flex flex-col gap-4'>
          <TradeButton 
            type='close' 
            callback={()=>make(tk, 'call', 'sell')} // close position on tk
            disabled={loading}
            />
          <TradeButton 
            text={<p>Buy call <span className='text-green-600'>▲</span></p>} 
            tk={tk}
            type='open' 
            callback={()=>make(tk, 'call', 'buy')}  // est. long position on call
            disabled={loading}
          />
          </div>

      {/* closing position reminder dot */}
      {isOpen.includes(tk) && order.put.side == 'buy' && <span className={`absolute right-full mr-3 top-3 text-4xl font-bold text-neutral`}>●</span>}
      {isOpen.includes(tk) && order.call.side == 'buy' && <span className={`absolute left-full ml-3 top-3 text-4xl font-bold text-neutral`}>●</span>}

      {/* preview */}
      <div className='cursor-pointer absolute top-1/3 right-full mr-5' onClick={()=>handlePreview(tk, 'put')}>
        <i className="ri-eye-line text-3xl"></i>
      </div>
      <div className='cursor-pointer absolute top-1/3 left-full ml-5' onClick={()=>handlePreview(tk, 'call')}>
        <i className="ri-eye-line text-3xl"></i>
      </div>
      <AnimatePresence>
        {preview.length > 0 && 
        <motion.span
          initial={{ opacity: 1 }}
          exit={{opacity: 0}}
          transition={{ duration: 0.8 }}
          className={`absolute top-1/3 ${previewSide == 'left'? 'right-full mr-16 text-orange-600' : 'left-full ml-16 text-green-500'} text-xl font-mono font-bold text-nowrap`}
        >
        {preview.join(' | ')}
        </motion.span>
        }
      </AnimatePresence>
      
      {/* Order Card */}
      <div className={`absolute -top-7 ${left? 'right-full mr-5' : 'left-full ml-5'}`}>
        {loading && <ColorRing wrapperClass={`absolute top-28 ${left? 'right-32' : 'left-32'}`} height="100" width="100"/>}
        {showOrder && 
        <div className='animate-enter'>
          <OrderCard order={left? order.put : order.call} setshow={setShowOrder}/>
        </div>
        }
      </div>
    {/* order button section end */}
    </div>
    
  {/* main tree end */}
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

function StockBoard({data, dark}){
  const maxColor = dark? '#00b500' : '#7efda0'
  const minColor = dark? '#a00' : '#ff99a5'
  return (
    <motion.div 
    animate={{backgroundColor: (data.mm.max)? maxColor : (data.mm.min)? minColor : null}}
    transition={{duration: 0.9, ease: 'easeOut'}}
    className={`w-[176px] border-6 ${dark? 'text-white' : null} ${data.p > 0? 'border-green-600' : 'border-red-600'} rounded-xl p-1 flex flex-col gap-1 text-xl items-start`}
    >
      {/* 第一行 first row */}
      <div className='flex flex-row gap-2 ml-1'>
        <span className='font-bold text-2xl'>{data.tk.toUpperCase()}</span>
        <span className={`text-xl w-20 font-mono ${(data.diff == 0) ? 'text-gray-400' : (data.diff > 0)? 'text-green-600' : 'text-red-600'}`}
        >
          {data.diff}{(data.diff > 0)? '⬆' : (data.diff < 0)? '⬇' : ''}
        </span>
      </div>

      {/* 第二行 second row */}
      <div className='font-bold text-xl ml-1'>{data.p}</div>
    </motion.div>
  )

}

function Plot({val, resist, vol, stat, len, opt, dark}){
  // plot real time stock price quote
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
  <div className='mb-3'>
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

  {/* Put Info */}
  {opt.put.strike > 0 && 
  <>
  {/* strike price dot */}
  <motion.circle cx={mid + (opt.put.strike - stat.prevClose)*scale} cy={(box.svh/4) + (box.h/2)} r={10} fill={box.strikePriceColor}/>
  <motion.text
  x={box.putInfoLoc} y={(box.svh/2) - box.h} fontSize={box.optFontsize} className={"font-mono"} fill={box.optionTextColor}> 
  open={opt.put.open} | exp {opt.put.exp} | strike={opt.put.strike} | {opt.put.type}
  </motion.text>
  </>
  }
  
  {/* Call Info */}
  {opt.call.strike > 0 && 
  <>
  {/* strike price dot */}
  <motion.circle cx={mid + (opt.call.strike - stat.prevClose)*scale} cy={(box.svh/4) + (box.h/2)} r={10} fill={box.strikePriceColor}/>
  <motion.text
  x={box.callInfoLoc} y={(box.svh/2) - box.h} fontSize={box.optFontsize} className={"font-mono"} fill={box.optionTextColor}> 
  {opt.call.type} | strike={opt.call.strike} | exp {opt.call.exp} | open={opt.call.open}
  </motion.text>
  </>
  }
  </motion.svg>
  </div>
  )
}

function DerivativePlot({opt, order, len}){
  const mid = len / 2
  const profit = (opt.price - order.exec_price) * order.qty * 100
  const x2 = mid + Math.max(Math.min(profit, 450), -450)
  
  const profitColor = profit > 0 ? "#00b700" : "#b50000"

  return (
    <div className='mb-10 -mt-5'>
    <motion.svg width={len} height="50">
    <motion.line  // derivative price vector
    animate={{x2: x2}} 
    transition={{ type: "spring" }}
    x1={mid} y1={20} x2={mid} y2={20} // set y > 0 to avoid truncation
    stroke={profitColor}
    strokeWidth={14} 
    opacity={1}
    />
    <motion.text // costPrice x qty text
      className={"font-bold"}
      x={mid-10} y={50} 
      fontSize={20} 
      fill={"gray"}
    >
      {order.exec_price}x{order.qty} {opt.type}
    </motion.text>

    <motion.text // real time option price text
      className={"font-bold"}
      x={x2-10} y={50} 
      fontSize={20} 
      fill={profitColor}
    >
      {opt.price}
    </motion.text>

    <motion.text  // profit text
      className={"font-bold"}
      dx={10} dy={-10} 
      x={profit > 0 ? x2 : x2-180} y={40} 
      fontSize={32} 
      fill={profitColor}
    >
    ${profit.toFixed(2)}
    </motion.text>
    </motion.svg>
    </div>
  )
}

function Factors({data}){
  // const controls = useAnimation();
  const size = 60
  const color = {
    '🔴': {main:'#ff153a', second:'#ff7869'},
    '⚪️': {main:'#b3b3b3', second:'#d4d2d9'},
    '🟢': {main:'#00d600', second:'#43ff68'},
  }

  return (
    <div className='flex flex-row gap-16 mt-6 mb-5'>
      {data.map(item => {
        return (
        <div 
        // animate={['cap','corr'].includes(item.title)? controls : null} 
        key={item.title} 
        className='relative group flex flex-col gap-2 items-center w-40'
        >
          {/* Timestamp */}
          {item.timestamp? <div className='absolute bottom-full text-3xl w-max rounded-lg bg-secondary text-secondary-content p-4 font-mono font-bold hidden group-hover:block'>{item.timestamp}</div> : null}
          
          {/* Circle */}
          <motion.svg width={size} height={size}>
            <motion.circle 
            animate={{r: [20, 30], opacity: [1, 0]}}
            transition={{duration: 2.2, repeat: Infinity}}
            cx={size/2} cy={size/2} fill={color[item.cls].second} 
            />
            <motion.circle cx={size/2} cy={size/2} r={20} fill={color[item.cls].main}/>
          </motion.svg>
          
          {/* Value */}
          <span className='text-2xl font-mono w-max'>{item.value}</span>    

          {/* (Dropdown if supp on) Title */}
          {item.supp? 
          <div className="dropdown">
          <div tabIndex="0" role="button" className="text-2xl font-bold btn w-max">{item.title}</div>
          <ul tabIndex="0" className="dropdown-content menu justify-center items-start bg-base-100 rounded-box z-[1] w-max shadow text-2xl font-mono font-bold">
            {item.supp.map((x, idx) => {
              return (
                <li key={idx} className={x.cls == '🟢'? 'text-green-600': 'text-red-600'}>
                  <span><pre>●&nbsp;{x.val}</pre></span>
                </li>
              )
            })}
          </ul>
          </div>
          
        : <span className='text-2xl font-bold'>{item.title}</span> }

      </div>
        )
      })}
    </div>
  )
}

// in the frontend, order obj means response returned by the backend 
function OrderCard({order, setshow}){
  return (
  <div className="card bg-base-100 text-nowrap shadow-xl">
    <div className="card-body">
      <div className='flex flex-row gap-2 text-2xl'>
        <i className="ri-checkbox-circle-line text-2xl text-green-500"></i>
        <h2>{order.name}</h2>
      </div>
      
      <table className='table text-2xl'>
      <tr> <th>status:</th> <td>{order.status}</td></tr>
      <tr><th>side:</th><td>{order.side}</td> </tr> 
      <tr><th>qty:</th> <td>{order.qty}</td></tr>
      <tr><th>price:</th> <td>{order.exec_price}</td></tr>
      {order.side == 'buy' && <tr className='text-red-600'><th>cost:</th> <td>{order.totalCost}</td></tr>}
      {order.side == 'sell' && <tr className={order.profit > 0? 'text-green-600' : 'text-red-600'}><th>profit:</th> <td>${order.profit} {order.profit > 0? '🎉🎉🎉' : ''}</td></tr>}
      <tr><th>time:</th> <td>{order.time}</td></tr>
      </table>
      
      <button  
      className="btn btn-outline btn-success text-lg font-mono mt-2"
      onClick={()=>setshow(false)}
      >
        Close
      </button>
    </div>
  </div>
  )
}

function TradeButton({text='close', tk='', callback=null, type='close', disabled=false}) {
  return (
    <button
    className={`relative border-4 ${type=='open'? 
      'btn btn-primary btn-outline w-60 h-40 text-3xl' : 
      'btn btn-outline w-60 h-16 text-2xl'}`
    }
    onClick={callback}
    disabled={disabled}
    >
      <span className='absolute top-2 text-2xl font-mono text-base-content'>{tk.toUpperCase()}</span>
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
    <div className='text-4xl font-bold border-8 w-52 border-neutral p-5 rounded-full'>
      {time.toLocaleTimeString('it-IT', options)}
    </div>
  );
};


export default App