FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY frontend ./frontend
COPY data ./data
EXPOSE 8000
# shell form so hosts that inject PORT (Render, HF Spaces, Railway) work;
# defaults to 8000 for local docker run
CMD uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000}
