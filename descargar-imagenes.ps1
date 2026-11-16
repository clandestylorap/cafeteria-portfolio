# Descarga las fotos de Unsplash que usa la web y las guarda en public/images,
# ya recortadas a su tamaño y en formato WebP (ligeras).
# Uso (desde la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File .\descargar-imagenes.ps1
#
# Las fotos son de Unsplash (licencia libre, uso comercial permitido, sin atribución obligatoria).

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$destino = Join-Path $PSScriptRoot "public\images"
New-Item -ItemType Directory -Force -Path $destino | Out-Null

# nombre del archivo = id de la foto en Unsplash, ancho, alto
$fotos = @(
  @("hero",              "1559496417-e7f25cb247f3", 1920, 1080),
  @("taza-cenital",      "1615464637805-16154b4d5ea1", 900, 900),
  @("tile-latte",        "1506372023823-741c83b836fe", 900, 700),
  @("tile-tueste",       "1561986810-4f3ba2f46ceb", 900, 700),
  @("tile-espresso",     "1609050471053-8636409f9f5b", 900, 700),
  @("origen-etiopia",    "1764232891094-a4a3e8c517e3", 1200, 1000),
  @("origen-colombia",   "1772228616071-aa344913b93e", 1200, 1000),
  @("recoleccion",       "1762277142890-24902d58e8f0", 500, 500),
  @("tueste",            "1511537190424-bbbab87ac5eb", 500, 500),
  @("molienda",          "1485808191679-5f86510681a2", 500, 500),
  @("barista",           "1586011066531-f3a64f20d51d", 500, 500),
  @("bolsa-cafe",        "1759421556847-84f8d88222ba", 900, 1100),
  @("proceso",           "1607681034540-2c46cc71896d", 1920, 1100),
  @("local",             "1645677020082-721a854c24f2", 1200, 900),
  @("tostada-aguacate",  "1515041761709-f9fc96e04cd3", 800, 800)
)

foreach ($f in $fotos) {
  $nombre, $id, $w, $h = $f
  $url = "https://images.unsplash.com/photo-$($id)?w=$w&h=$h&fit=crop&crop=entropy&fm=webp&q=75"
  $salida = Join-Path $destino "$nombre.webp"
  Invoke-WebRequest -Uri $url -OutFile $salida -UseBasicParsing
  $kb = [math]::Round((Get-Item $salida).Length / 1KB)
  Write-Host ("OK  {0,-18} {1,4} KB" -f "$nombre.webp", $kb)
}

Write-Host ""
Write-Host "Listo: $($fotos.Count) imagenes guardadas en public\images"
