# Vantage Spree API = the official Spree image + a thin layer of Vantage code.
#
# Pin SPREE_IMAGE to an exact tag in production; `latest` is for local dev only.
ARG SPREE_IMAGE=ghcr.io/spree/spree:latest
FROM ${SPREE_IMAGE}

# The official image runs the Rails app from /rails (the same path the Spree CLI
# mounts in dev). If a future image moves it, override with --build-arg APP_ROOT=…
ARG APP_ROOT=/rails
WORKDIR ${APP_ROOT}

COPY --chown=rails:rails app/models/vantage/ ${APP_ROOT}/app/models/vantage/
COPY --chown=rails:rails config/initializers/vantage.rb ${APP_ROOT}/config/initializers/vantage.rb
