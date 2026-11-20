# Lokal ML, PyTorch, CUDA və Docker Mühiti Bələdçisi

## 1. Brauzer Kod Laboratoriyasının Dürüst Sərhədləri

**AI Engineering Academy** daxilindəki Python laboratoriyası (**Pyodide WebAssembly Web Worker**) tamamilə brauzerdə, oflayn və host sistemdən təcrid olunmuş şəkildə işləyir.

- **Brauzer Sandbox-da Nə İşləyir:**
  - **Python 3.12 standart kitabxanası** (`math`, `statistics`, `json`, `re`, `collections`, `itertools`, `functools`, `dataclasses`, `typing`, `sqlite3`, `datetime`, `csv`, `random`, `hashlib`, `unittest`).
  - Bütün 58 kurikulum kod tapşırığı və `stdin`/`stdout` skriptləri, sonsuz dövrə qarşı Web Worker timeout qoruması ilə.
  - İzolyasiya olunmuş `:memory:` SQLite **SQL Sandbox** (worker-thread timeout + 4 MiB yaddaş limiti ilə).
- **Brauzer Sandbox-da Nə İşləmir (və niyə iddia etmirik):**
  - **PyTorch / CUDA / GPU training**, **scikit-learn / XGBoost / LightGBM**, **DuckDB / Apache Spark**, **FastAPI live server**, **Docker konteynerləri** və **xarici şəbəkə zəngləri**.
  - Bu ağır mühəndislik layihələri üçün aşağıdakı təcrid olunmuş lokal mühiti qurmaq lazımdır.

---

## 2. Qabaqcıl ML / Deep Learning Layihələri üçün Lokal Mühit Quraşdırılması

### Variant A — Linux / WSL2 (Windows-da tövsiyə olunur)
Windows-da Application Control (WDAC) bəzi native `.pyd` DLL-lərini bloklaya bilərsə və ya CUDA GPU təlimi lazımdırsa, **WSL2 (Ubuntu)** və ya **Docker** ən etibarlı yoldur:

```bash
# 1. Layihə qovluğu və virtual mühit yarat
mkdir -p ~/ai-projects/my-ml-project && cd ~/ai-projects/my-ml-project
python3 -m venv .venv
source .venv/bin/activate

# 2. Əsas ML və Data Engineering paketləri
pip install --upgrade pip
pip install numpy pandas scikit-learn lightgbm duckdb pyarrow pytest fastapi uvicorn pydantic

# 3. PyTorch (CPU və ya CUDA — rəsmi pytorch.org əmrinə uyğun)
# CPU-only:
pip install torch --index-url https://download.pytorch.org/whl/cpu
# NVIDIA CUDA 12.4 GPU üçün:
# pip install torch --index-url https://download.pytorch.org/whl/cu124
```

### Variant B — Docker Konteyneri (Reproducible & Təcrid Olunmuş)
Həm Windows, həm macOS, həm də Linux-da tam eyni mühit üçün:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["pytest", "-q"]
```

```powershell
# İmage qur və təcrid olunmuş testləri işə sal
docker build -t my-ai-project .
docker run --rm my-ai-project
```

### Layihə Kodunu Academy-də Yoxlatdırmaq
Lokal mühitdə yazdığın `.py`, `.sql`, `Dockerfile` və ya test nəticələrini **AI Engineering Academy → `5. Projects`** bölməsinə əlavə edərək:
1. **Senior AI Engineer AI Code Review** ala bilərsən,
2. Real `pytest` / eval çıxışını **Milestone Evidence** bölməsinə qeyd edib bacarıqlarını sübut edə bilərsən.
