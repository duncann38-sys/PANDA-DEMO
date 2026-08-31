FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /home/myuser
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional

COPY . ./
RUN chown -R pwuser:pwuser /home/myuser

USER pwuser

CMD ["npm", "start", "--silent"]