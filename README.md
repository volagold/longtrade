# longtrade

longtrade is a full-stack option trading system based on the [longport API](https://open.longportapp.com/en/) provided by [Longbridge Securities](https://longbridge.com).

## Features
- simple and efficient
- real-time price quotes
- automatically placing orders

## How to use
1. Open up a margin account at [longbridge.com](https://longbridge.com).
2. Apply for API keys at [longport](https://open.longportapp.com).
3. You also need to subscribe for OPRA real-time option data at around 22 HKD/month. You can place your order in the longbridge mobile app. 
3. Clone this repository to your local machine. Place your keys according to the backend code.
4. **Backend.** create a python environment, and install dependencies with `pip install -r requirements.txt`.
5. **Frontend.** make sure [node.js](https://nodejs.org/en) is installed. `cd` to `frontend`, and install dependencies with `npm install`.
6. **Start service.** In terminal, `cd` to this repo, run 
```shell
./serve.sh
```
to start backend service, open a separate terminal window and run 
```shell
./app.sh
```
to start frontend service. Then go to `http://localhost:5173/` to use the application.

## Demo
![](/demo.gif)


