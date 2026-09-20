from plate.api import from_environment

if __name__ == '__main__':
    from waitress import serve
    serve(from_environment(), host='127.0.0.1', port=8080, max_request_body_size=8192, channel_timeout=30)
