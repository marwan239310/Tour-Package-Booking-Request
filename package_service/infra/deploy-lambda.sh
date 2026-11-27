
#!/usr/bin/env bash
set -euo pipefail

# ==========================================
# FLOCI Lambda configuration
# ==========================================

FUNCTION_NAME="PackageServiceLambda"
AWS_PROFILE="floci"
AWS_REGION="us-east-1"
ENDPOINT_URL="http://localhost:4566"
DYNAMODB_ENDPOINT="http://host.docker.internal:4566"

# ==========================================
# Locate project directories
# ==========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../src" && pwd)"

# ==========================================
# Create temporary deployment directory
# ==========================================

TEMP_DIR="$(mktemp -d)"
BUILD_DIR="$TEMP_DIR/build"
ZIP_FILE="$TEMP_DIR/package-service.zip"

TEMP_DIR_WINDOWS="$(cygpath -m "$TEMP_DIR")"

cleanup() {
    rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

echo "Preparing Package Service deployment..."

# ==========================================
# Check required tools
# ==========================================

for tool in npm aws powershell.exe cygpath; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: Required tool '$tool' was not found."
        exit 1
    fi
done

# ==========================================
# Check required source files
# ==========================================

if [[ ! -f "$SOURCE_DIR/lambda.js" ]]; then
    echo "ERROR: lambda.js is missing."
    exit 1
fi

if [[ ! -f "$SOURCE_DIR/server.js" ]]; then
    echo "ERROR: server.js is missing."
    exit 1
fi

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
    echo "ERROR: package.json is missing."
    exit 1
fi

if [[ ! -f "$SOURCE_DIR/package-lock.json" ]]; then
    echo "ERROR: package-lock.json is missing."
    exit 1
fi

# ==========================================
# Prepare deployment files
# ==========================================

mkdir -p "$BUILD_DIR"

cp -R "$SOURCE_DIR"/. "$BUILD_DIR"/

# Remove local dependencies and secrets
rm -rf "$BUILD_DIR/node_modules"
rm -f "$BUILD_DIR/.env"
rm -f "$BUILD_DIR/lambda.zip"

# ==========================================
# Install production dependencies
# ==========================================

echo "Installing production dependencies..."

cd "$BUILD_DIR"

npm ci --omit=dev

if [[ ! -d "$BUILD_DIR/node_modules/serverless-http" ]]; then
    echo "ERROR: serverless-http is missing."
    exit 1
fi

# ==========================================
# Create deployment ZIP
# ==========================================


echo "Creating deployment archive..."

powershell.exe -NoProfile -Command "\$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; \$rootPath = (Get-Item -LiteralPath '$TEMP_DIR_WINDOWS/build').FullName.TrimEnd('\'); \$destination = '$TEMP_DIR_WINDOWS/package-service.zip'; if (Test-Path \$destination) { Remove-Item \$destination -Force }; \$archive = [System.IO.Compression.ZipFile]::Open(\$destination, [System.IO.Compression.ZipArchiveMode]::Create); try { Get-ChildItem -LiteralPath \$rootPath -File -Recurse -Force | ForEach-Object { \$relative = \$_.FullName.Substring(\$rootPath.Length + 1).Replace('\','/'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(\$archive, \$_.FullName, \$relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { \$archive.Dispose() }"
if [[ ! -f "$ZIP_FILE" ]]; then
    echo "ERROR: Deployment ZIP was not created."
    exit 1
fi


# ==========================================
# Build-only verification
# ==========================================

if [[ "${BUILD_ONLY:-0}" == "1" ]]; then

    echo "Checking deployment archive contents..."
echo "Checking ZIP directory separators..."
powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; \$zip = [System.IO.Compression.ZipFile]::OpenRead('$TEMP_DIR_WINDOWS/package-service.zip'); try { \$zip.Entries | Select-Object -First 25 -ExpandProperty FullName } finally { \$zip.Dispose() }"
powershell.exe -NoProfile -Command "\$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; \$zip = [System.IO.Compression.ZipFile]::OpenRead('$TEMP_DIR_WINDOWS/package-service.zip'); try { \$entry = \$zip.Entries | Where-Object { \$_.FullName -like 'node_modules/serverless-http/serverless-http.js' }; if (-not \$entry) { throw 'Expected forward-slash ZIP path was not found.' }; Write-Output \$entry.FullName; Write-Output 'ZIP PATHS VALIDATED' } finally { \$zip.Dispose() }"
    VERIFY_DIR="$TEMP_DIR_WINDOWS/verify"

    powershell.exe -NoProfile -Command "\$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '$TEMP_DIR_WINDOWS/package-service.zip' -DestinationPath '$VERIFY_DIR' -Force; \$required = @('lambda.js','server.js','package.json','node_modules/serverless-http/package.json'); foreach (\$file in \$required) { if (-not (Test-Path (Join-Path '$VERIFY_DIR' \$file))) { throw \"Missing file: \$file\" } }; Write-Output 'ZIP CONTENTS VALIDATED'"

    echo "Testing dependency resolution from extracted ZIP..."

powershell.exe -NoProfile -Command "\$ErrorActionPreference = 'Stop'; Set-Location '$VERIFY_DIR'; node -p 'require.resolve(String.fromCharCode(115,101,114,118,101,114,108,101,115,115,45,104,116,116,112))'"

echo "DEPENDENCY RESOLUTION SUCCESSFUL"

    echo "BUILD-ONLY TEST: Deployment archive created successfully."

    powershell.exe -NoProfile -Command "Get-Item '$TEMP_DIR_WINDOWS/package-service.zip' | Select-Object Name,Length"

    exit 0
fi

# ==========================================
# Update Lambda environment variables
# ==========================================

echo "Updating Lambda environment variables..."

aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={DYNAMODB_TABLE=Packages,DYNAMODB_ENDPOINT=$DYNAMODB_ENDPOINT}" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --endpoint-url "$ENDPOINT_URL" \
    --no-cli-pager

# ==========================================
# Upload deployment package
# ==========================================

echo "Uploading Lambda deployment package..."

aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$TEMP_DIR_WINDOWS/package-service.zip" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --endpoint-url "$ENDPOINT_URL" \
    --no-cli-pager

echo "Lambda deployment commands completed."
