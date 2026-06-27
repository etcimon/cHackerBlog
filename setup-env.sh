#!/bin/bash
#
# cHackerBlog Environment Setup Script
# Checks for required dependencies (Redis, PostgreSQL) and helps configure .env file from .env.example
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

echo -e "${CYAN}cHackerBlog Environment Setup${NC}"
echo -e "${CYAN}=============================${NC}"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if Redis is running
check_redis() {
    echo -e "${YELLOW}Checking Redis connection...${NC}"
    
    if command_exists redis-cli; then
        if redis-cli ping >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Redis is running and accessible${NC}"
            return 0
        fi
    fi
    
    # Try using nc or telnet if redis-cli is not available
    if command_exists nc; then
        if nc -z localhost 6379 2>/dev/null; then
            echo -e "${GREEN}✓ Redis port 6379 is accessible${NC}"
            return 0
        fi
    fi
    
    echo -e "${RED}✗ Redis is not running or not accessible${NC}"
    echo -e "${RED}  Please install Redis and start it:${NC}"
    echo -e "${RED}  - macOS: brew install redis && brew services start redis${NC}"
    echo -e "${RED}  - Linux: sudo apt-get install redis-server && sudo systemctl start redis${NC}"
    echo -e "${RED}  - Or use Docker: docker run -d -p 6379:6379 redis${NC}"
    return 1
}

# Function to check if PostgreSQL is running
check_postgresql() {
    local host="${1:-localhost}"
    local port="${2:-5432}"
    
    echo -e "${YELLOW}Checking PostgreSQL connection...${NC}"
    
    if command_exists psql; then
        if PGPASSWORD="" psql -h "$host" -p "$port" -U postgres -c "SELECT 1" >/dev/null 2>&1; then
            echo -e "${GREEN}✓ PostgreSQL is running and accessible${NC}"
            return 0
        fi
    fi
    
    # Try using nc or telnet if psql is not available
    if command_exists nc; then
        if nc -z "$host" "$port" 2>/dev/null; then
            echo -e "${GREEN}✓ PostgreSQL port $port is accessible${NC}"
            return 0
        fi
    fi
    
    echo -e "${RED}✗ PostgreSQL is not running or not accessible${NC}"
    echo -e "${RED}  Please install PostgreSQL and start it:${NC}"
    echo -e "${RED}  - macOS: brew install postgresql && brew services start postgresql${NC}"
    echo -e "${RED}  - Linux: sudo apt-get install postgresql && sudo systemctl start postgresql${NC}"
    echo -e "${RED}  - Or use Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres${NC}"
    return 1
}

# Function to generate a random string
generate_random_string() {
    local length="${1:-32}"
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
}

# Check for .env.example
if [ ! -f ".env.example" ]; then
    echo -e "${RED}✗ .env.example file not found in current directory${NC}"
    exit 1
fi

# Check if .env already exists
if [ -f ".env" ]; then
    echo -e "${YELLOW}⚠ .env file already exists${NC}"
    read -p "Overwrite existing .env file? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Setup cancelled${NC}"
        exit 0
    fi
fi

echo -e "${CYAN}Checking dependencies...${NC}"
echo ""

redis_available=false
postgres_available=false

if check_redis; then
    redis_available=true
fi

if check_postgresql; then
    postgres_available=true
fi

echo ""

if [ "$redis_available" = false ]; then
    echo -e "${YELLOW}⚠ Redis is required for caching and rate limiting${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${CYAN}Environment Configuration${NC}"
echo -e "${CYAN}========================${NC}"
echo ""

# Read .env.example
env_example=$(cat .env.example)
env_content="$env_example"

# Prompt for configuration
read -p "Environment type (development/production) [development]: " env_type
env_type=${env_type:-development}

read -p "App URL [http://localhost:3000]: " app_url
app_url=${app_url:-http://localhost:3000}

db_provider="sqlite"
db_url="file:./dev.db"

if [ "$env_type" = "production" ]; then
    read -p "Database provider (sqlite/postgresql) [postgresql]: " db_provider
    db_provider=${db_provider:-postgresql}
    
    if [ "$db_provider" = "postgresql" ]; then
        if [ "$postgres_available" = false ]; then
            echo -e "${RED}✗ PostgreSQL is required for production with PostgreSQL provider${NC}"
            exit 1
        fi
        
        read -p "PostgreSQL host [localhost]: " db_host
        db_host=${db_host:-localhost}
        
        read -p "PostgreSQL port [5432]: " db_port
        db_port=${db_port:-5432}
        
        read -p "Database name [chackerblog]: " db_name
        db_name=${db_name:-chackerblog}
        
        read -p "Database user [postgres]: " db_user
        db_user=${db_user:-postgres}
        
        read -sp "Database password: " db_pass
        echo
        if [ -z "$db_pass" ]; then
            echo -e "${YELLOW}⚠ Database password is required for PostgreSQL${NC}"
            exit 1
        fi
        
        db_url="postgresql://${db_user}:${db_pass}@${db_host}:${db_port}/${db_name}"
    fi
fi

read -p "Redis URL [redis://localhost:6379]: " redis_url
redis_url=${redis_url:-redis://localhost:6379}

session_secret=$(generate_random_string 32)
echo -e "${GREEN}Generated SESSION_SECRET: $session_secret${NC}"

read -p "Admin password [changeme]: " admin_password
admin_password=${admin_password:-changeme}

# Replace values in .env content
env_content=$(echo "$env_content" | sed "s/NODE_ENV=development/NODE_ENV=$env_type/")
env_content=$(echo "$env_content" | sed "s|APP_URL=http://localhost:3000|APP_URL=$app_url|")
env_content=$(echo "$env_content" | sed "s/DATABASE_PROVIDER=sqlite/DATABASE_PROVIDER=$db_provider/")
env_content=$(echo "$env_content" | sed "s|DATABASE_URL=\"file:./dev.db\"|DATABASE_URL=\"$db_url\"|")
env_content=$(echo "$env_content" | sed "s|REDIS_URL=redis://localhost:6379|REDIS_URL=$redis_url|")
env_content=$(echo "$env_content" | sed "s/SESSION_SECRET=replace-with-a-long-random-string/SESSION_SECRET=$session_secret/")
env_content=$(echo "$env_content" | sed "s/ADMIN_PASSWORD=changeme/ADMIN_PASSWORD=$admin_password/")
env_content=$(echo "$env_content" | sed "s/^LOG_LEVEL=.*/LOG_LEVEL=error/")

# Write .env file
echo "$env_content" > .env

echo ""
echo -e "${GREEN}✓ .env file created successfully${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "${WHITE}1. Review and adjust .env file if needed${NC}"
echo -e "${WHITE}2. Run: bun install${NC}"
echo -e "${WHITE}3. Run: bun run db:migrate${NC}"
echo -e "${WHITE}4. Run: bun run db:seed (optional)${NC}"
echo -e "${WHITE}5. Run: bun run dev${NC}"
echo ""
