# Built from services/maps (the compose build context). The runtime image is just the static
# binary on distroless: no shell, no package manager.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mapsd ./cmd/mapsd \
    && mkdir -p /out/traffic

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/mapsd /mapsd
# A fresh named volume mounted at /traffic copies this directory's ownership, so the
# non-root process can write OSRM's speed file there.
COPY --from=build --chown=nonroot:nonroot /out/traffic /traffic
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/mapsd"]
