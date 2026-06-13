#!/usr/bin/env bash
pip install -r requirements.txt
exec uvicorn backend.app:app --host 0.0.0.0 --port 8000
