# Build stage
FROM golang:alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates tzdata

ENV GOTOOLCHAIN=auto

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/etcms-api ./cmd/etcms-api && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/etcms-worker ./cmd/etcms-worker && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/etcms-migrate ./cmd/etcms-migrate

# Runtime stage
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata dumb-init && \
    addgroup -g 10001 -S etcms && \
    adduser -u 10001 -S etcms -G etcms

WORKDIR /app

COPY --from=builder /bin/etcms-api /app/etcms-api
COPY --from=builder /bin/etcms-worker /app/etcms-worker
COPY --from=builder /bin/etcms-migrate /app/etcms-migrate

USER 10001:10001

EXPOSE 8080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/etcms-api"]
