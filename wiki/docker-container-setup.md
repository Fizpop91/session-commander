## Docker Container Setup
<br>

**Environment Variables**

| Variable | Default Value | Description |
| ----------- | ----------- | ----------- |
| SESSION_COMMANDER_SECRET_KEY | - | Secret key for SMTP password encryption. If not set, one will automatically be generated |

<br>

**Docker Run**

`docker run --name session-commander -p 3000:3000 -v ./data:/app/data --restart unless-stopped `

**Docker Compose**

See Docker compose file here: [docker-compose.yml](https://github.com/Fizpop91/session-commander/blob/main/docker-compose.yml)
