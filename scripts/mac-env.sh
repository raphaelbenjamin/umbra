#!/bin/bash
# Environnement de compilation de Umbra.

step() { echo ""; echo "› $1"; }
fail() { echo ""; echo "✗ $1"; echo ""; echo "Le journal complet est dans $LOG"; read -n 1 -s -r -p "Appuyez sur une touche pour fermer…"; exit 1; }

step "Outils de développement d'Apple"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  fail "Installez les « Command Line Tools » dans la fenêtre qui vient de s'ouvrir, puis relancez ce fichier."
fi
echo "  ok"

step "Homebrew"
BREW=""
for b in /opt/homebrew/bin/brew /usr/local/bin/brew "$HOME/.homebrew/bin/brew"; do
  if [ -x "$b" ]; then BREW="$b"; break; fi
done
if [ -z "$BREW" ]; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || fail "Homebrew n'a pas pu être installé."
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && BREW="$b"; done
fi
eval "$("$BREW" shellenv)"
echo "  ok"

step "Node.js et CMake"
command -v node >/dev/null 2>&1 || "$BREW" install node || fail "Node.js n'a pas pu être installé."
command -v cmake >/dev/null 2>&1 || "$BREW" install cmake || fail "CMake n'a pas pu être installé."
echo "  ok : node $(node -v)"

step "Rust"
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
rust_minor() { cargo -V 2>/dev/null | sed -E 's/cargo 1\.([0-9]+).*/\1/'; }
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal || fail "Rust n'a pas pu être installé."
  source "$HOME/.cargo/env"
fi
if [ "$(rust_minor)" -lt 85 ] 2>/dev/null; then
  echo "  Mise à jour de Rust…"
  if command -v rustup >/dev/null 2>&1; then rustup update stable && rustup default stable
  elif "$BREW" list rust >/dev/null 2>&1; then "$BREW" upgrade rust
  fi
  hash -r
fi
echo "  ok : $(cargo -V)"

step "Dépendances"
npm install --no-audit --no-fund >/dev/null || fail "npm install a échoué."
echo "  ok"
