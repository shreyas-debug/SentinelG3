// tests/fixtures/vuln.go
// Deliberately vulnerable Go file — contains a goroutine race condition.
// Used by tests/test_multilang.py to verify the Auditor detects Go vulnerabilities.

package main

import (
	"fmt"
	"sync"
)

// sharedCounter is accessed concurrently without synchronisation.
// Multiple goroutines both read and write this variable, causing a
// data race that produces unpredictable results.
var sharedCounter int

func incrementWithoutLock(wg *sync.WaitGroup) {
	defer wg.Done()
	for i := 0; i < 1000; i++ {
		sharedCounter++ // RACE: concurrent read-modify-write with no mutex
	}
}

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go incrementWithoutLock(&wg)
	}
	wg.Wait()
	fmt.Println("Final counter:", sharedCounter) // Result is non-deterministic
}
