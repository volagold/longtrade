echo "Starting backend..."
cd backend
python api.py &
echo "Starting frontend..."
cd ../frontend && npm run dev