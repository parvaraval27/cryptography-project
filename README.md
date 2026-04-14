# Exchange Solvency Proof System

## What This Does

This system cryptographically proves that a cryptocurrency exchange is **solvent** (total user balances ≤ reserves) **without revealing:**
- Individual user balances
- The total sum of liabilities

It combines two cryptographic proofs:

### 1. **Merkle Sum Tree Proof** 🌳
- User proves their balance is included in the exchange's balance sheet
- Exchange publishes a Merkle root committing to all user balances
- User can verify both hash path integrity and sum consistency without seeing other balances

### 2. **zk-SNARK Solvency Proof** 🔐
- Exchange proves: `sum(all balances) ≤ reserves`
- Proof is cryptographically valid without revealing individual balances
- Verifier can confirm solvency without learning the sum

---

## System Components

```
┌─────────────────────────────────────────┐
│   EXCHANGE (Prover)                     │
│                                         │
│  balances = [100, 50, 200, 80, ...]   │
│  reserves = 500                         │
│                                         │
│  ✅ Generates Merkle root              │
│  ✅ Generates zk-SNARK proof           │
└─────────────────────────────────────────┘
           │
           │ publishes
           ▼
   ┌──────────────────┐
   │ Merkle Root      │
   │ Proof JSON       │
   │ Verification Key │
   └──────────────────┘
           │
           │ users verify locally
           ▼
┌─────────────────────────────────────────┐
│   USER (Verifier)                       │
│                                         │
│  ✅ Verifies: "my balance is included" │
│  ✅ Verifies: "exchange is solvent"    │
│                                         │
│  ❌ Never sees individual balances     │
│  ❌ Never learns the sum               │
└─────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- **Node.js 16+**
- **Circom 2.1+** (for circuit compilation)
- **curl or wget** (for downloading Powers of Tau)

### Installation (3 steps)

```bash
# 1. Install dependencies
npm install

# 2. Setup circuit (compiles, downloads ptau, generates keys)
npm run setup

# 3. Run the application
npm start
```

That's it! The setup script automates all the heavy lifting.

---

## Usage Example

```bash
$ npm start

Enter number of users: 4
Enter user 1 (format: id balance): Alice 100
Enter user 2 (format: id balance): Bob 50
Enter user 3 (format: id balance): Carol 200
Enter user 4 (format: id balance): Dave 80

═══════════════════════════════════════════════════
        EXCHANGE SOLVENCY PROOF SYSTEM
═══════════════════════════════════════════════════

📋 Users loaded: 4
💰 Choose a mode:

  1️⃣  Generate Merkle Tree (inclusion proofs)
  2️⃣  Prove Solvency with zk-SNARK
  3️⃣  Verify Merkle Inclusion Proof
  4️⃣  Verify Solvency Proof
  5️⃣  Full Verification (Merkle + zk-SNARK)
  6️⃣  Show User Balances
  0️⃣  Exit

Select mode (0-6): 2
```

**Mode 2: Prove Solvency**
- Exchange enters reserves: `500`
- Generates cryptographic proof that 430 ≤ 500
- ✅ Proof is valid and saved

**Mode 4: Verify Proof**
- User loads the saved proof
- Verifies exchange is solvent
- ❌ Cannot see individual balances or sum

**Mode 5: Full Verification**
- User verifies their balance is included (Merkle)
- User verifies exchange is solvent (zk-SNARK)
- Combined proof of inclusion + solvency

---

## How It Works (Technical)

### Merkle Sum Tree Flow

```
Step 1: Exchange builds Merkle tree from all balances
        balances -> hash each leaf -> build tree upward

Step 2: Exchange publishes the root hash (commitment)

Step 3: User requests inclusion proof for their balance
        Exchange provides: [sibling1, sibling2, ...]

Step 4: User verifies: hash(leaf) + sibling sums -> should match root hash and root sum
        ✅ If match: balance is in tree and sum-path is consistent
        ❌ If no match: balance not
 included
```

### zk-SNARK Flow

```
Step 1: Exchange has private balances and public reserves
        balances = [100, 50, 200, 80]  (secret)
        reserves = 500                  (public)

Step 2: Prove inside a circuit that constraints hold:
        - Each balance ≥ 0 and < 2^64
        - sum = balance[0] + balance[1] + ...
        - sum ≤ reserves

Step 3: Generate proof using circuit + witness
        proof = Hash(constraints + randomness)

Step 4: Verifier checks proof signature
        ✅ Valid: constraints were satisfied
        ❌ Invalid: someone lied

Key insight: Proof is mathematically binding
            If balances or sum were faked → proof generation fails
```

---

## File Structure

```
Merkle_tree/
├── circuits/
│   └── Solvency.circom              # Circuit definition
├── src/
│   ├── index.js                     # CLI application
│   ├── merkleTree.js                # Merkle proof logic
│   ├── zkProof.js                   # zk-SNARK integration
│   └── utils.js                     # Hash functions
├── proofs/                          # Generated artifacts
│   ├── Solvency.r1cs                # Constraints (compiled)
│   ├── Solvency_js/                 # WASM witness calculator
│   ├── Solvency_final.zkey          # Proving key
│   └── verification_key.json        # Public verification key
├── setup.js                         # Automated setup script
├── package.json
├── README.md                        # This file
└── SETUP.md                         # Detailed setup guide
```

---

## Security Properties

### What Can Be Verified

✅ **Exchange is solvent**: `sum(balances) ≤ reserves`  
✅ **No negative balances**: All balances ≥ 0  
✅ **Proof is unforgeable**: Using cryptographic commitments

### What Remains Hidden

❌ **Individual balances**: Never revealed  
❌ **Total liabilities**: Sum is private  
❌ **User identities**: Merkle proof doesn't authenticate user

---

## Advanced Topics

### Customizing User Count

Default: 16 users. To change:

1. Edit `circuits/Solvency.circom`:
```circom
component main = Solvency(32);  // Change 16 to your target
```

2. Recompile:
```bash
npm run setup
```

### Using Different Proof Systems

Currently uses **PLONK** (snarkjs default). Could also use:
- **Groth16** - Smaller proof size
- **Fflonk** - Faster verification
- **IPA** - Post-quantum secure (experimental)

Change in `zkProof.js` proof generation and verification functions.

### Running on AWS/Cloud

The setup can be deployed to cloud:
```bash
# Build Docker image
docker build -t solvency-proof .
docker run -it solvency-proof npm start
```

(Dockerfile example not included; adapt as needed)

---

## Troubleshooting

**Q: "Circuit not compiled" error?**  
A: Run `npm run setup` to compile

**Q: "Not enough disk space" during setup?**  
A: The ptau file is 2.5 GB. Ensure sufficient disk space.

**Q: "Cannot find circom"?**  
A: Install globally: `npm install -g circom`

**Q: Proof generation is very slow?**  
A: Normal for first-time setup. WASM compilation takes time.

**Q: Can I use different PTau files?**  
A: Yes, but need to match circuit degree. See SETUP.md advanced section.

---

## References

- **Merkle Trees**: Classic data structure for commitment/inclusion proofs
- **zk-SNARK**: Succinct Non-Interactive Arguments of Knowledge
- **Circom**: Domain-specific language for circuits
- **snarkjs**: JavaScript implementation of proof generation/verification
- **PLONK**: Proof system used by snarkjs

---

## Disclaimer

This is a **demonstration system** for educational purposes. For production use:

1. ✅ Audit the circuit for correctness
2. ✅ Use formal verification for constraints
3. ✅ Implement proper trusted setup ceremony (MPC)
4. ✅ Add cryptographic commitment schemes (e.g., Pedersen)
5. ✅ Integrate with real exchange infrastructure
6. ✅ Test extensively under security conditions

---

## Questions?

For detailed setup help, see [SETUP.md](./SETUP.md)

For theory, see references above or reach out!
