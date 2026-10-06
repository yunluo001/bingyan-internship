// BiliLuckyDraw practice server.
// Static host + whitelisted reverse proxy + raw WebSocket relay.
// No business logic lives here: it only forwards bytes so the browser can talk
// to bilibili without CORS problems.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// route maps a local path prefix to one bilibili host.
type route struct {
	prefix  string
	host    string
	referer string
}

var routes = []route{
	{prefix: "/api", host: "api.bilibili.com", referer: "https://www.bilibili.com/"},
	{prefix: "/live", host: "api.live.bilibili.com", referer: "https://live.bilibili.com/"},
	{prefix: "/passport", host: "passport.bilibili.com", referer: "https://passport.bilibili.com/"},
}

// danmaku hosts accepted by the ws relay.
var wsHostSuffixes = []string{
	".chat.bilibili.com",
	".chat.bilibili.co",
}

var upstream = &http.Client{Timeout: 30 * time.Second}

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	webDir := flag.String("web", "web", "static files directory")
	flag.Parse()

	mux := http.NewServeMux()
	for _, r := range routes {
		mux.Handle(r.prefix+"/", proxy(r))
	}
	mux.HandleFunc("/ws", relay)
	mux.Handle("/", noCache(http.FileServer(http.Dir(*webDir))))

	srv := &http.Server{Addr: *addr, Handler: withCORS(mux)}

	fmt.Printf("BiliLuckyDraw practice server\n  http://%s\n  web root: %s\n", *addr, *webDir)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
}

// withCORS lets the page be opened from any origin (e.g. file:// or a live server).
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Cookie")
		w.Header().Set("Access-Control-Expose-Headers", "X-Set-Cookie, X-Cookie")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// proxy forwards the request to the mapped bilibili host and copies the response
// back. Set-Cookie is collapsed into a single X-Set-Cookie header because the
// browser refuses to expose cross-origin Set-Cookie to JavaScript.
func proxy(r route) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		target := "https://" + r.host + strings.TrimPrefix(req.URL.Path, r.prefix)
		if req.URL.RawQuery != "" {
			target += "?" + req.URL.RawQuery
		}

		var body io.Reader
		if req.Body != nil {
			raw, err := io.ReadAll(req.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			body = bytes.NewReader(raw)
		}

		out, err := http.NewRequestWithContext(req.Context(), req.Method, target, body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		out.Header.Set("User-Agent", browserUA)
		out.Header.Set("Accept", "application/json, text/plain, */*")
		out.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
		out.Header.Set("Referer", r.referer)
		out.Header.Set("Origin", strings.TrimSuffix(r.referer, "/"))
		// Browsers drop a hand-written Cookie header, so the page sends the
		// bilibili cookie in X-Cookie instead. Plain Cookie still works for
		// curl and other non-browser clients.
		if ck := cookieOf(req); ck != "" {
			out.Header.Set("Cookie", ck)
			out.Header.Set("X-Requested-With", "XMLHttpRequest")
		}
		if ct := req.Header.Get("Content-Type"); ct != "" {
			out.Header.Set("Content-Type", ct)
		}

		resp, err := upstream.Do(out)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if cookies := resp.Header.Values("Set-Cookie"); len(cookies) > 0 {
			w.Header().Set("X-Set-Cookie", flattenCookies(cookies))
		}
		w.WriteHeader(resp.StatusCode)
		w.Write(data)
	}
}

// cookieOf reads the bilibili cookie a client wants to forward.
// Browsers refuse to send a hand-written Cookie header, so the page uses
// X-Cookie; curl and other clients can simply use Cookie.
func cookieOf(r *http.Request) string {
	if ck := strings.TrimSpace(r.Header.Get("X-Cookie")); ck != "" {
		return ck
	}
	return r.Header.Get("Cookie")
}

// flattenCookies keeps only name=value pairs and joins them into one header.
func flattenCookies(raw []string) string {
	parts := make([]string, 0, len(raw))
	for _, c := range raw {
		if i := strings.IndexByte(c, ';'); i > 0 {
			c = c[:i]
		}
		parts = append(parts, strings.TrimSpace(c))
	}
	return strings.Join(parts, "; ")
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(*http.Request) bool { return true },
}

// relay pipes a browser WebSocket to an upstream danmaku host, byte for byte.
// Usage: /ws?upstream=wss%3A%2F%2F<host>%2Fsub&cookie=<urlencoded cookie>
// All protocol work (auth packet, heartbeat, decompression) stays in the browser.
func relay(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("upstream")
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		http.Error(w, "bad upstream", http.StatusBadRequest)
		return
	}
	if u.Scheme != "wss" || !allowedWSHost(u.Hostname()) {
		http.Error(w, "upstream host not allowed", http.StatusForbidden)
		return
	}

	header := http.Header{}
	header.Set("User-Agent", browserUA)
	header.Set("Origin", "https://live.bilibili.com")
	if ck := r.URL.Query().Get("cookie"); ck != "" {
		header.Set("Cookie", ck)
	}

	up, resp, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		status := http.StatusBadGateway
		if resp != nil {
			status = resp.StatusCode
		}
		http.Error(w, "dial upstream: "+err.Error(), status)
		return
	}
	defer up.Close()

	down, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer down.Close()

	done := make(chan struct{}, 2)
	pipe := func(dst, src *websocket.Conn) {
		defer func() { done <- struct{}{} }()
		for {
			kind, data, err := src.ReadMessage()
			if err != nil {
				return
			}
			if err := dst.WriteMessage(kind, data); err != nil {
				return
			}
		}
	}
	go pipe(up, down)
	go pipe(down, up)
	<-done
}

func allowedWSHost(host string) bool {
	for _, s := range wsHostSuffixes {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	return false
}
