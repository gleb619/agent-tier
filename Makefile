GO     ?= /usr/local/go/bin/go
BINDIR := bin
PKG    := mock-agent

.PHONY: build test-go clean

build:
	cd $(PKG) && $(GO) build -o ../$(BINDIR)/mock-agent       ./cmd/mock-agent
	cd $(PKG) && $(GO) build -o ../$(BINDIR)/mock-long-agent  ./cmd/mock-long-agent

test-go:
	cd $(PKG) && $(GO) test ./...

clean:
	rm -f $(BINDIR)/mock-agent $(BINDIR)/mock-long-agent
