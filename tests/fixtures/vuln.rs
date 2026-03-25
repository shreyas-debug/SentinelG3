// tests/fixtures/vuln.rs
// Deliberately vulnerable Rust file — unsafe pointer dereference.
// Used by tests/test_multilang.py to verify Auditor detects Rust vulnerabilities.

fn main() {
    // VULNERABILITY: Raw pointer created from a null address and dereferenced in
    // an unsafe block. This causes undefined behaviour (typically a segfault).
    let raw_ptr: *mut i32 = 0x0 as *mut i32;

    unsafe {
        // Dereferencing a null/arbitrary-address raw pointer is immediate UB.
        *raw_ptr = 42; // UNSAFE: null pointer dereference
        println!("Value: {}", *raw_ptr);
    }

    // VULNERABILITY: integer overflow — in debug builds this panics,
    // in release builds it wraps silently, producing incorrect results.
    let max: u8 = 255;
    let overflow = max + 1; // wrapping overflow in release mode
    println!("Overflowed: {}", overflow);
}
