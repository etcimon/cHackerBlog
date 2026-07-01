#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Setup script for cHackerBlog environment configuration.
.DESCRIPTION
    Checks for required dependencies (Redis, PostgreSQL) and helps configure .env file from .env.example.
.NOTES
    Run this script from the project root directory.
#>

$ErrorActionPreference = "Stop"

Write-Host "cHackerBlog Environment Setup" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# Function to check if Redis is running
function Test-Redis {
    Write-Host "Checking Redis connection..." -ForegroundColor Yellow
    try {
        if (Test-Command "redis-cli") {
            $result = redis-cli ping 2>&1
            if ($LASTEXITCODE -eq 0 -and $result -eq "PONG") {
                Write-Host "✓ Redis is running and accessible" -ForegroundColor Green
                return $true
            }
        }
        
        # Try using Test-NetConnection if redis-cli is not available
        try {
            $connection = Test-NetConnection -ComputerName localhost -Port 6379 -WarningAction SilentlyContinue -InformationLevel Quiet
            if ($connection) {
                Write-Host "✓ Redis port 6379 is accessible" -ForegroundColor Green
                return $true
            }
        } catch {
            # Ignore errors
        }
        
        Write-Host "✗ Redis is not running or not accessible" -ForegroundColor Red
        Write-Host "  Please install Redis and start it:" -ForegroundColor Red
        Write-Host "  - Windows: Download from https://redis.io/download" -ForegroundColor Red
        Write-Host "  - Or use Docker: docker run -d -p 6379:6379 redis" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "✗ Redis check failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Function to check if PostgreSQL is running
function Test-PostgreSQL {
    param([string]$DbHost = "localhost", [int]$Port = 5432)

    Write-Host "Checking PostgreSQL connection..." -ForegroundColor Yellow
    try {
        if (Test-Command "psql") {
            $null = psql -h $DbHost -p $Port -U postgres -c "SELECT 1" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ PostgreSQL is running and accessible" -ForegroundColor Green
                return $true
            }
        }

        # Try using Test-NetConnection if psql is not available
        try {
            $connection = Test-NetConnection -ComputerName $DbHost -Port $Port -WarningAction SilentlyContinue -InformationLevel Quiet
            if ($connection) {
                Write-Host "✓ PostgreSQL port $Port is accessible" -ForegroundColor Green
                return $true
            }
        } catch {
            # Ignore errors
        }

        Write-Host "✗ PostgreSQL is not running or not accessible" -ForegroundColor Red
        Write-Host "  Please install PostgreSQL and start it:" -ForegroundColor Red
        Write-Host "  - Windows: Download from https://www.postgresql.org/download/windows/" -ForegroundColor Red
        Write-Host "  - Or use Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "✗ PostgreSQL check failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Function to generate a random string
function New-RandomString {
    param([int]$Length = 32)
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $random = New-Object System.Random
    $result = -join (1..$Length | ForEach-Object { $chars[$random.Next(0, $chars.Length)] })
    return $result
}

# Check for .env.example
if (-not (Test-Path ".env.example")) {
    Write-Host "✗ .env.example file not found in current directory" -ForegroundColor Red
    exit 1
}

# Check if .env already exists
if (Test-Path ".env") {
    Write-Host "⚠ .env file already exists" -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite existing .env file? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Setup cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "Checking dependencies..." -ForegroundColor Cyan
Write-Host ""

$redisAvailable = Test-Redis
$postgresAvailable = Test-PostgreSQL

if (-not $redisAvailable) {
    Write-Host ""
    Write-Host "⚠ Redis is required for caching and rate limiting" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}

Write-Host ""
Write-Host "Environment Configuration" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# Read .env.example
$envExample = Get-Content ".env.example" -Raw
$envContent = $envExample

# Prompt for theme selection
Write-Host "Select theme:" -ForegroundColor Cyan
Write-Host "  (1) hacker   - Green-on-black terminal aesthetic (default)" -ForegroundColor White
Write-Host "  (2) medium   - Clean minimalist design" -ForegroundColor White
Write-Host "  (3) substack - Warm paper-like appearance" -ForegroundColor White
$themeChoice = Read-Host "Theme [1]"
switch ($themeChoice) {
    "2" { $theme = "medium" }
    "3" { $theme = "substack" }
    default { $theme = "hacker" }
}
Write-Host "Selected theme: $theme" -ForegroundColor Green

# Prompt for configuration
$envType = Read-Host "Environment type (development/production) [development]"
if ([string]::IsNullOrWhiteSpace($envType)) { $envType = "development" }

$appUrl = Read-Host "App URL [http://localhost:3000]"
if ([string]::IsNullOrWhiteSpace($appUrl)) { $appUrl = "http://localhost:3000" }

$dbProvider = "sqlite"
$dbUrl = "file:./dev.db"

if ($envType -eq "production") {
    $dbProvider = Read-Host "Database provider (sqlite/postgresql) [postgresql]"
    if ([string]::IsNullOrWhiteSpace($dbProvider)) { $dbProvider = "postgresql" }
    
    if ($dbProvider -eq "postgresql") {
        if (-not $postgresAvailable) {
            Write-Host "✗ PostgreSQL is required for production with PostgreSQL provider" -ForegroundColor Red
            exit 1
        }
        
        $dbHost = Read-Host "PostgreSQL host [localhost]"
        if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost = "localhost" }
        
        $dbPort = Read-Host "PostgreSQL port [5432]"
        if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort = "5432" }
        
        $dbName = Read-Host "Database name [chackerblog]"
        if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "chackerblog" }
        
        $dbUser = Read-Host "Database user [postgres]"
        if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "postgres" }
        
        $dbPass = Read-Host "Database password"
        if ([string]::IsNullOrWhiteSpace($dbPass)) {
            Write-Host "⚠ Database password is required for PostgreSQL" -ForegroundColor Yellow
            exit 1
        }
        
        $dbUrl = "postgresql://$($dbUser):$($dbPass)@$($dbHost):$($dbPort)/$($dbName)"
    }
}

$redisUrl = Read-Host "Redis URL [redis://localhost:6379]"
if ([string]::IsNullOrWhiteSpace($redisUrl)) { $redisUrl = "redis://localhost:6379" }

$sessionSecret = New-RandomString 32
Write-Host "Generated SESSION_SECRET: $sessionSecret" -ForegroundColor Green

$adminPassword = Read-Host "Admin password [changeme]"
if ([string]::IsNullOrWhiteSpace($adminPassword)) { $adminPassword = "changeme" }

# Replace values in .env content
$envContent = $envContent -replace 'NODE_ENV=development', "NODE_ENV=$envType"
$envContent = $envContent -replace 'APP_URL=http://localhost:3000', "APP_URL=$appUrl"
$envContent = $envContent -replace 'THEME=hacker', "THEME=$theme"
$envContent = $envContent -replace 'DATABASE_PROVIDER=sqlite', "DATABASE_PROVIDER=$dbProvider"
$envContent = $envContent -replace 'DATABASE_URL="file:./dev.db"', "DATABASE_URL=`"$dbUrl`""
$envContent = $envContent -replace 'REDIS_URL=redis://localhost:6379', "REDIS_URL=$redisUrl"
$envContent = $envContent -replace 'SESSION_SECRET=replace-with-a-long-random-string', "SESSION_SECRET=$sessionSecret"
$envContent = $envContent -replace 'ADMIN_PASSWORD=changeme', "ADMIN_PASSWORD=$adminPassword"
$envContent = $envContent -replace '^LOG_LEVEL=.*', 'LOG_LEVEL=error'

# Write .env file
$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

# Update Prisma schema provider
Write-Host "Updating Prisma schema provider to $dbProvider..." -ForegroundColor Yellow
$schemaPath = "prisma/schema.prisma"
if (Test-Path $schemaPath) {
    $schemaContent = Get-Content $schemaPath -Raw
    $schemaContent = $schemaContent -replace 'provider = "sqlite"', "provider = `"$dbProvider`""
    $schemaContent = $schemaContent -replace 'provider = "postgresql"', "provider = `"$dbProvider`""
    $schemaContent | Out-File -FilePath $schemaPath -Encoding UTF8 -NoNewline
    Write-Host "✓ Prisma schema updated to use $dbProvider" -ForegroundColor Green
} else {
    Write-Host "⚠ Prisma schema file not found at $schemaPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✓ .env file created successfully" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Review and adjust .env file if needed" -ForegroundColor White
Write-Host "2. Run: bun install" -ForegroundColor White
Write-Host "3. Run: bun run db:migrate" -ForegroundColor White
Write-Host "4. Run: bun run db:seed (optional)" -ForegroundColor White
Write-Host "5. Run: bun run dev" -ForegroundColor White
Write-Host ""
