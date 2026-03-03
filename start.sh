#!/bin/bash
set -e

echo "Running database migrations..."
uv run python migrate_db.py

echo "Starting application..."
exec uv run main.py
