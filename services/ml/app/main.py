from fastapi import FastAPI

app = FastAPI(title="ServiGo ML service", version="2.0.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "servigo-ml"}
