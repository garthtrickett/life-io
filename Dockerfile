# File: Dockerfile

# Use the official Bun image as the base
FROM oven/bun:1.2

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and the lockfile first to leverage Docker's layer caching.
# If these files don't change, Docker won't need to re-run the install step.
COPY package.json bun.lock ./

# Install dependencies inside the container.
# Using --frozen-lockfile is best practice for CI/production environments.
RUN bun install --frozen-lockfile

# Copy the rest of your application's source code AND the pre-built 'dist' folder.
# The .dockerignore file will prevent node_modules from being copied.
COPY . .

# We no longer run `bun run build` here because it's already been done locally.

# Expose the port your app runs on
EXPOSE 42069

# The command to start the application
CMD ["bun", "run", "start"]
