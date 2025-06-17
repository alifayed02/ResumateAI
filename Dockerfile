# Stage 1: Base Node.js image
FROM node:20-slim AS base

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Set the working directory
WORKDIR /usr/src/app

# Stage 2: Install Node dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Stage 3: Final runtime image with LaTeX
FROM base AS runner

# Install minimal LaTeX packages required for pdflatex
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-lang-english \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory again (each stage is independent)
WORKDIR /usr/src/app

# Copy installed node_modules from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy application code
COPY . .

# Expose the port your app listens on
EXPOSE 3001

# Start your app
CMD ["node", "src/index.js"]