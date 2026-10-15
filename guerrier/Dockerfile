FROM python:3.12-slim

# curl sert à la démo : kubectl exec <pod> -- curl -X POST localhost:8080/freeze
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py names.py ./

# Utilisateur non-root
RUN useradd -u 10001 app
USER 10001

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "app.py"]
