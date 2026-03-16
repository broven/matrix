FROM alpine:3.21
RUN apk add --no-cache libstdc++
COPY matrix-server /usr/local/bin/matrix-server
COPY web/ /app/web/
WORKDIR /app
EXPOSE 3000
CMD ["matrix-server", "--port", "3000", "--web", "/app/web"]
