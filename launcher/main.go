package main

import (
	"bytes"
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed web
var embeddedWeb embed.FS

const defaultIdleTimeout = 10 * time.Minute

func main() {
	options := flag.NewFlagSet("PhongVietStudio", flag.ContinueOnError)
	serveOnly := options.Bool("serve-only", false, "print the local Studio URL without opening a browser")
	idleTimeout := options.Duration("idle-timeout", defaultIdleTimeout, "close Studio after this interval without a heartbeat")
	if err := options.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		showError(err)
		os.Exit(2)
	}
	if *idleTimeout <= 0 || options.NArg() != 0 {
		showError(errors.New("Tham số khởi động không hợp lệ."))
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *serveOnly, *idleTimeout); err != nil {
		showError(err)
		os.Exit(1)
	}
}

func run(ctx context.Context, serveOnly bool, idleTimeout time.Duration) error {
	web, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		return fmt.Errorf("Không mở được tài nguyên Studio: %w", err)
	}
	if _, err := fs.Stat(web, "index.html"); err != nil {
		return fmt.Errorf("Thiếu trang khởi động Studio: %w", err)
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("Không mở được kết nối cục bộ: %w", err)
	}
	defer listener.Close()

	host := listener.Addr().String()
	origin := "http://" + host
	started := time.Now()
	quit := make(chan struct{})
	var quitOnce sync.Once
	var lastHeartbeat atomic.Int64
	server := &http.Server{
		Handler: newHandler(web, host, origin, func() {
			lastHeartbeat.Store(int64(time.Since(started)))
		}, func() {
			quitOnce.Do(func() { close(quit) })
		}),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	defer server.Close()

	serverErr := make(chan error, 1)
	go func() { serverErr <- server.Serve(listener) }()
	if serveOnly {
		fmt.Fprintln(os.Stdout, origin)
	} else if err := openBrowser(origin); err != nil {
		return err
	}

	checkInterval := idleTimeout / 5
	if checkInterval <= 0 {
		checkInterval = idleTimeout
	} else if checkInterval > 5*time.Second {
		checkInterval = 5 * time.Second
	}
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return shutDown(server)
		case <-quit:
			return shutDown(server)
		case err := <-serverErr:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return fmt.Errorf("Kết nối cục bộ gặp lỗi: %w", err)
		case <-ticker.C:
			if time.Since(started)-time.Duration(lastHeartbeat.Load()) >= idleTimeout {
				return shutDown(server)
			}
		}
	}
}

func shutDown(server *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Close also stops any requests that outlive the grace period.
	defer server.Close()
	return server.Shutdown(ctx)
}

func newHandler(web fs.FS, host string, origin string, heartbeat, quit func()) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:")
		if r.Host != host {
			http.Error(w, "Unexpected host.", http.StatusMisdirectedRequest)
			return
		}

		switch r.URL.Path {
		case "/_studio/heartbeat":
			if r.Method != http.MethodGet {
				w.Header().Set("Allow", http.MethodGet)
				http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "Forbidden.", http.StatusForbidden)
				return
			}
			heartbeat()
			w.WriteHeader(http.StatusNoContent)
			return
		case "/_studio/quit":
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get("Origin") != origin {
				http.Error(w, "Forbidden.", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			quit()
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(web, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		switch path.Ext(name) {
		case ".html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		case ".js":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		case ".css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case ".ttf":
			w.Header().Set("Content-Type", "font/ttf")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})
}
