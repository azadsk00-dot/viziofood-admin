# Copies orders-android to a short path (C:\vo) for local Gradle builds.
# Windows ninja/cmake path limits break native builds from the long repo path.
$src = 'C:\Users\azads\Documents\viziofood-admin\orders-android'
$dst = 'C:\vo'

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }

# Exclude only THIS project's generated native/build outputs — bare-name /XD
# would also strip node_modules/**/build directories the toolchain needs.
robocopy $src $dst /E /MT:16 /NFL /NDL /NJH /NP /XD `
  (Join-Path $src 'android\app\.cxx') `
  (Join-Path $src 'android\app\build') `
  (Join-Path $src 'android\build') `
  (Join-Path $src 'android\.gradle') `
  (Join-Path $src '.expo') `
  (Join-Path $src '.gradle') | Out-Null

Write-Output "node_modules intact: $(Test-Path (Join-Path $dst 'node_modules\expo-modules-autolinking\build'))"
Write-Output "gradlew present: $(Test-Path (Join-Path $dst 'android\gradlew.bat'))"
exit 0
