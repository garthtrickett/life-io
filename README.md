# Life IO - Project Setup

This document outlines the steps required to set up and run the Life IO application locally.

## 1. Prerequisites

Before you begin, ensure you have the following installed on your system:

- **[Bun](https://bun.sh/)**: A fast JavaScript runtime.
- **[Docker](https://www.docker.com/get-started/)** and **[Docker Compose](https://docs.docker.com/compose/install/)**: For running the PostgreSQL database.

## 2. Environment Setup

This project uses a `.env` file to manage environment variables.

1.  **Create the `.env` file**: Copy the `.env.example` to a new file named `.env` in the root of the project.
2.  **Add Database URL**: The default `DATABASE_URL` is already configured for the local Docker setup.
    ```
    DATABASE_URL=postgres://postgres:postgres@localhost:6543/main
    ```
3.  **Add Logging Tokens**: Add your BetterStack source tokens to the `.env` file for both the server and the client.

## 3. Installation & Database Setup

1.  **Open your terminal** and navigate to the root directory of the project.
2.  **Install dependencies**:
    ```bash
    bun install
    ```
3.  **Start the Database**: The project uses Docker Compose to run a PostgreSQL database in a container.
    ```bash
    docker-compose up -d
    ```
4.  **Run Migrations & Seed**: With the database running, set up the schema and initial test data.
    ```bash
    bun run migrate
    ```

## 4. Running the Application

### Development Mode

For development with live-reloading for both the frontend and backend, run:

```bash
bun run dev
```
