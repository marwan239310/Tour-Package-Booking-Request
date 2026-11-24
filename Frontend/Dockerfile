
FROM nginx:stable

COPY . /usr/share/nginx/html

RUN sed -i 's/js\/config.js/js\/config.docker.js/' /usr/share/nginx/html/index.html

EXPOSE 80
