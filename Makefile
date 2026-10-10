GO     ?= /usr/local/go/bin/go
BINDIR := bin
PKG    := mock-agent

.PHONY: build test-go clean

build:
	$(GO) build -o $(BINDIR)/mock-agent       ./$(PKG)/cmd/mock-agent
	$(GO) build -o $(BINDIR)/mock-long-agent  ./$(PKG)/cmd/mock-long-agent

test-go:
	cd $(PKG) && $(GO) test ./...

clean:
	rm -f $(BINDIR)/mock-agent $(BINDIR)/mock-long-agent
