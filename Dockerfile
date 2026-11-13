FROM php:8.2-cli

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git curl zip unzip libzip-dev libsqlite3-dev \
    && docker-php-ext-install pdo_sqlite zip pcntl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Copy composer files first for caching
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts

# Copy the rest of the app
COPY . .

# Run post-install scripts
RUN composer run-script post-autoload-dump 2>/dev/null || true

# Create SQLite database
RUN mkdir -p database && touch database/database.sqlite

# Set permissions
RUN chmod -R 775 storage bootstrap/cache database

# Generate key if not set
RUN php artisan key:generate --force 2>/dev/null || true

# Run migrations
RUN php artisan migrate --force 2>/dev/null || true

# Build assets are served from Vercel, so no need for npm here

EXPOSE ${PORT:-8000}

CMD php artisan migrate --force 2>/dev/null; php artisan db:seed --force 2>/dev/null; php artisan serve --host=0.0.0.0 --port=${PORT:-8000}

