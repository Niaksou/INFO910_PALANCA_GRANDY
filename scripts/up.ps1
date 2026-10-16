# Lance Pod Royale en une seule commande sous Windows (PowerShell 5.1 ou 7) :
# Docker, cluster, images, déploiement, puis ouvre l'arène via un port-forward.
#
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Port 9090 -NoBrowser
#   -Ingress : active aussi l'addon ingress de minikube (pod-royale.local)
param([int]$Port = 8080, [switch]$NoBrowser, [switch]$Ingress)
Set-Location (Join-Path $PSScriptRoot '..')

$Url = "http://localhost:$Port"
$Images = [ordered]@{ 'pod-royale/guerrier:1.0' = 'guerrier'; 'pod-royale/arena:1.0' = 'arena' }

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd introuvable. $hint" }
}
# Lance une commande native et s'arrête si elle échoue
function Run {
  $exe, $rest = $args
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { throw "Échec : $($args -join ' ')" }
}
# Teste une commande native en silence
function Ok {
  $exe, $rest = $args
  & $exe @rest *> $null
  return $LASTEXITCODE -eq 0
}

Need docker  'Installer Docker Desktop : https://docs.docker.com/desktop/setup/install/windows-install/'
Need kubectl 'Installer kubectl : https://kubernetes.io/docs/tasks/tools/'

# 1. Docker doit tourner (on lance Docker Desktop si besoin)
if (-not (Ok docker info)) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $desktop) {
    Write-Host '⏳ Démarrage de Docker Desktop…'
    Start-Process $desktop
    for ($i = 0; $i -lt 60 -and -not (Ok docker info); $i++) { Start-Sleep 2 }
  }
  if (-not (Ok docker info)) { throw 'Docker ne répond pas : lancez Docker Desktop puis relancez ce script' }
}

# 2. Un cluster joignable : celui du contexte courant, sinon on démarre minikube
if (Ok kubectl get --raw=/readyz --request-timeout=5s) {
  Write-Host "☸️  Cluster joignable : $(kubectl config current-context)"
} else {
  Need minikube 'Aucun cluster joignable : installez minikube (https://minikube.sigs.k8s.io) ou démarrez votre cluster.'
  Write-Host '☸️  Démarrage de minikube…'
  Run minikube start
}
$Context = kubectl config current-context
# L'accès passe par un port-forward : le contrôleur nginx ne sert que pour pod-royale.local
if ($Ingress -and $Context -like 'minikube*') { Run minikube addons enable ingress }

# 3. Images (même logique que build.sh)
foreach ($img in $Images.Keys) { Run docker buildx build --load -t $img $Images[$img] }
foreach ($img in $Images.Keys) {
  if ($Context -like 'minikube*') { Run minikube image load $img --overwrite=true }
  elseif ($Context -like 'kind-*') { Run kind load docker-image $img --name $Context.Substring(5) }
}

# 4. Déploiement (même logique que deploy.sh)
Run kubectl apply -f k8s/
# Tag fixe 1.0 : une empreinte du code source dans le template du pod déclenche un rollout
# quand le code change (pas l'ID de l'image : buildx en génère un nouveau à chaque build)
foreach ($app in 'guerrier', 'arena') {
  $files = Get-ChildItem $app -Recurse -File | Where-Object { $_.FullName -notmatch '__pycache__' } | Sort-Object FullName
  $all = ($files | ForEach-Object { $_.Name + ':' + (Get-FileHash $_.FullName -Algorithm SHA1).Hash }) -join "`n"
  $sha1 = [Security.Cryptography.SHA1]::Create()
  $hash = (-join ($sha1.ComputeHash([Text.Encoding]::UTF8.GetBytes($all)) | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)
  $patch = '{"spec":{"template":{"metadata":{"annotations":{"pod-royale/code":"' + $hash + '"}}}}}'
  $patchFile = [IO.Path]::GetTempFileName()
  Set-Content -Path $patchFile -Value $patch -Encoding ascii
  Run kubectl -n pod-royale patch deployment $app --type merge --patch-file $patchFile
  Remove-Item $patchFile
}
Write-Host '⏳ Attente des déploiements…'
Run kubectl -n pod-royale rollout status statefulset/redis --timeout=180s
Run kubectl -n pod-royale rollout status deployment/guerrier --timeout=180s
Run kubectl -n pod-royale rollout status deployment/arena --timeout=180s

# 5. Accès à l'arène par port-forward (pas d'Ingress, de tunnel ni de fichier hosts à gérer)
Write-Host "`n🔌 Port-forward svc/arena → $Url"
$log = [IO.Path]::GetTempFileName()
$pf = Start-Process kubectl -ArgumentList '-n', 'pod-royale', 'port-forward', 'svc/arena', "${Port}:80" `
  -NoNewWindow -PassThru -RedirectStandardOutput $log
try {
  for ($i = 0; $i -lt 40; $i++) {
    if ($pf.HasExited) { throw "Port-forward impossible (port $Port déjà pris ? essayez -Port 9090)" }
    try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $NoBrowser) { Start-Process $Url }
  Write-Host "`n⚔️  Pod Royale tourne : $Url"
  Write-Host '   Ctrl+C coupe l''accès (le jeu continue dans le cluster). Tout supprimer : kubectl delete namespace pod-royale'
  Wait-Process -Id $pf.Id
} finally {
  Stop-Process -Id $pf.Id -ErrorAction SilentlyContinue
  Remove-Item $log -ErrorAction SilentlyContinue
}
