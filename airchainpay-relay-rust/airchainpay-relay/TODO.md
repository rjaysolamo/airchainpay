# TODO Items - AirChainPay Relay Rust

## Protobuf Implementation Issues

### Location: src/utils/protobuf_compressor.rs

**Total TODO Items: 4**

1. **Line 165:**
   ```
   // TODO: The following functions are commented out because the protobuf types are missing.
   ```
   - **Context:** Related to `transaction_payload_to_json` function implementation
   - **Issue:** Missing protobuf type definitions for TransactionPayload

2. **Line 211:**
   ```
   // TODO: The following functions are commented out because the protobuf types are missing.
   ```
   - **Context:** Related to `token_to_json` function implementation
   - **Issue:** Missing protobuf type definitions for Token

3. **Line 235:**
   ```
   // TODO: The following functions are commented out because the protobuf types are missing.
   ```
   - **Context:** Related to `payment_metadata_to_json` function implementation
   - **Issue:** Missing protobuf type definitions for PaymentMetadata

4. **Line 250:**
   ```
   // TODO: The following functions are commented out because the protobuf types are missing.
   ```
   - **Context:** Related to additional protobuf type implementations
   - **Issue:** Missing protobuf type definitions for various payment-related types

## Summary

- **Issue:** All TODOs relate to missing protobuf type definitions that need to be implemented
- **Impact:** Protobuf compression/decompression functionality is incomplete
- **Priority:** High - affects core transaction processing capabilities
- **Action Required:** Implement missing protobuf types and uncomment related functions