# Life IO - Project Setup

This document outlines the steps required to set up and run the Life IO application locally.

## 1. Prerequisites

Before you begin, ensure you have the following installed on your system:

-   **[Bun](https://bun.sh/)**: A fast JavaScript runtime.
-   **[Docker](https://www.docker.com/get-started/)** and **[Docker Compose](https://docs.docker.com/compose/install/)**: For running the PostgreSQL database.

## 2. Environment Setup

This project uses a `.env` file to manage environment variables.

1.  **Create the `.env` file**: If it doesn't already exist, create a file named `.env` in the root of the project.
2.  **Add Database URL**: Add the following line to your `.env` file. This is the connection string for the local PostgreSQL database managed by Docker.

    ```
    DATABASE_URL=postgres://postgres:postgres@localhost:6543/main
    ```

## 3. Installation

Once the prerequisites are met, follow these steps to install the project dependencies:

1.  **Open your terminal** and navigate to the root directory of the project.
2.  **Install dependencies** using Bun:

    ```bash
    bun install
    ```

    This command will read the `package.json` file and install all the necessary packages listed in `dependencies` and `devDependencies`.

## 4. Running the Application

Follow these steps in order to start the database and the application server.

### Step 1: Start the Database

The project uses Docker Compose to run a PostgreSQL database in a container.

1.  Make sure the Docker daemon is running on your system.
2.  In your terminal, run the following command to start the database service in the background:

    ```bash
    docker-compose up -d
    ```

    You can verify that the database is running by executing `docker ps`. You should see a container named `life-io-postgres-1` (or similar) with the status "Up".

### Step 2: Run Database Migrations and Seeding

With the database running, you need to set up the schema and initial data.

1.  The project's `package.json` includes a handy script for this. In your terminal, run:

    ```bash
    bun run migrate
    ```

    This command executes migration scripts to create the `user`, `note`, `tag`, and `note_tag` tables, and then **runs a seed script to create a default test user**. This user is required for the verification step below.

### Step 3: Start the Application Server

Now you are ready to start the Elysia application server.

1.  Run the main entry point of the application:

    ```bash
    bun run index.ts
    ```

2.  If everything is successful, you will see the following message in your console:

    ```
    🦊  Elysia listening on http://localhost:42069
    ```

## 5. How to Verify

Your application is now running. You can interact with it at `http://localhost:42069`.

To test the `POST /note` endpoint, you can use a tool like `curl`:

```bash
curl -X POST http://localhost:42069/note \
-H "Content-Type: application/json" \
-d '{
  "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "title": "My First Note",
  "content": "This is a test note created via curl."
}'
