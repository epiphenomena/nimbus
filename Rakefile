# Rakefile -- Nimbus
#
# `rake -T` lists every task. Ruby is only the task runner; the work is done
# by node and wrangler (Cloudflare's CLI, a dev dependency: npm install).
#
# Deploys to https://nimbus.literal.work/ on Cloudflare as static assets only
# (dist/, built from an allowlist by tools/build-dist.mjs). No Worker script,
# no secrets, no server data: the browser fetches api.weather.gov directly and
# keeps saved locations in localStorage.
#
# First time: `npm install`, `npx wrangler login`, then `rake deploy`.

require "json"

PROJECT  = __dir__
APP      = JSON.parse(File.read(File.join(PROJECT, "app.json")))   # name lives there (and wrangler.toml)
SITE_URL = ENV["SITE"] || "https://#{APP["host"]}/"                # SITE= points verify elsewhere
DEV_PORT = "8788"

def wrangler(*args, **opts)
  Dir.chdir(PROJECT) { sh("npx", "wrangler", *args, **opts) }
end

task default: :check

desc "Check the JS, the Python tools, and that sw.js lists every app file"
task :check do
  Dir.chdir(PROJECT) do
    js = Dir["sw.js", "js/**/*.js", "tools/*.mjs"].sort
    js.each { |f| sh "node", "--check", f }
    sh "python3", "-c", "import ast, sys; [ast.parse(open(f).read(), f) for f in sys.argv[1:]]", *Dir["tools/*.py"]
    shell = File.read("sw.js")[/const SHELL = \[(.*?)\];/m, 1].scan(/'([^']+)'/).flatten
    missing = shell.reject { |f| f == "./" || File.exist?(f) }
    abort "sw.js SHELL lists missing files: #{missing.join(", ")}" unless missing.empty?
    unlisted = Dir["js/*.js", "css/*.css", "vendor/*.{js,css}"] - shell
    abort "Not in sw.js SHELL (won't work offline): #{unlisted.join(", ")}" unless unlisted.empty?
    puts "#{js.size} JS files, sw.js shell list: OK"
  end
end

desc "Build dist/: the files Cloudflare serves (an allowlist)"
task build: :check do
  Dir.chdir(PROJECT) { sh "node", "tools/build-dist.mjs" }
end

desc "Run locally at http://127.0.0.1:#{DEV_PORT} (wrangler dev on dist/)"
task dev: :build do
  wrangler "dev", "--port", DEV_PORT, "--ip", "127.0.0.1"
end

desc "Rebuild icons/*.png from tools/make-icons.py (slow: ~1 min)"
task :icons do
  Dir.chdir(PROJECT) { sh "python3", "tools/make-icons.py" }
end

desc "check + build + deploy + verify -- the normal way to ship"
task deploy: :build do
  wrangler "deploy"
  Rake::Task[:verify].invoke
end

desc "Probe the live site: the app's files are served, nothing else is"
task :verify do
  require "net/http"
  require "uri"
  base = URI(SITE_URL)
  http = Net::HTTP.start(base.host, base.port, use_ssl: base.scheme == "https")
  get = ->(path) { http.request(Net::HTTP::Get.new(base.path + path)) }
  failures = []
  expect = lambda do |label, res, codes|
    ok = Array(codes).include?(res.code.to_i)
    puts format("  %-28s %s %s", label, res.code, ok ? "ok" : "EXPECTED #{Array(codes).join("/")}")
    failures << label unless ok
  end

  res = get.("")
  expect.("app shell", res, 200)
  expect.("app name in title", Struct.new(:code).new(res.body.to_s.include?("<title>#{APP["name"]}</title>") ? 200 : 500), 200)
  %w[manifest.webmanifest sw.js icons/icon-192.png icons/icon.svg js/app.js vendor/uPlot.iife.min.js].each { |p| expect.(p, get.(p), 200) }
  # Never part of dist/, so never served.
  %w[Rakefile app.json package.json package-lock.json wrangler.toml tools/build-dist.mjs tools/make-icons.py
     node_modules/wrangler/package.json .dev.vars dist/index.html].each { |p| expect.(p, get.(p), 404) }
  http.finish
  abort "verify: #{failures.size} check(s) failed" unless failures.empty?
  puts "verify: OK"
end
