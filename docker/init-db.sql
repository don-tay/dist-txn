-- Create databases for each service
CREATE DATABASE transaction_db;
CREATE DATABASE wallet_db;

-- Create users with limited privileges
CREATE USER transaction_user WITH ENCRYPTED PASSWORD 'transaction_pass';
CREATE USER wallet_user WITH ENCRYPTED PASSWORD 'wallet_pass';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE transaction_db TO transaction_user;
GRANT ALL PRIVILEGES ON DATABASE wallet_db TO wallet_user;

-- Connect to transaction_db and grant schema privileges
\c transaction_db
GRANT ALL ON SCHEMA public TO transaction_user;

-- Connect to wallet_db and grant schema privileges
\c wallet_db
GRANT ALL ON SCHEMA public TO wallet_user;

