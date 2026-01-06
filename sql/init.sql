cat > sql/init.sql << 'EOF'
-- Database initialization script
-- Run this when setting up PostgreSQL

CREATE DATABASE travelbot;
CREATE USER traveluser WITH ENCRYPTED PASSWORD 'travelpass';
GRANT ALL PRIVILEGES ON DATABASE travelbot TO traveluser;

-- Connect to the database and create extensions
\c travelbot;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF
