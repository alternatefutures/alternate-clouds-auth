#!/bin/bash
# Build and push service-auth Docker image (code only, no secrets)
#
# Usage: ./build-and-push.sh [tag]
#
# Prerequisites:
# 1. Docker installed and running
# 2. Logged into GitHub Container Registry:
#    echo $GITHUB_PAT | docker login ghcr.io -u USERNAME --password-stdin

set -e

IMAGE_NAME="ghcr.io/alternatefutures/service-auth"
TAG="${1:-latest}"

echo "Building Docker image (code only, no secrets)..."
docker build -t "$IMAGE_NAME:$TAG" .

echo ""
echo "Pushing to GitHub Container Registry..."
docker push "$IMAGE_NAME:$TAG"

echo ""
echo "Done! Image pushed to $IMAGE_NAME:$TAG"
echo ""
echo "Secrets are injected via SDL environment variables at deploy time."
echo "The image contains only application code."
