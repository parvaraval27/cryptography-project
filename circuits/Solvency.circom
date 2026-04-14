template RangeCheck(N) {
  signal input in;
  signal bits[N];
  var acc = 0;
  for (var i = 0; i < N; i++) {
    bits[i] <-- (in >> i) & 1;
    bits[i] * (bits[i] - 1) === 0;
    acc += (1 << i) * bits[i];
  }
  acc === in;
}

template Solvency(N) {
  signal input balances[N];
  signal input reserves;
    signal input merkleRoot;
    signal output reservesPublic;
    signal output merkleRootPublic;
  signal partial_sum[N];
  component balanceChecks[N];
  for (var i = 0; i < N; i++) {
    balanceChecks[i] = RangeCheck(64);
    balanceChecks[i].in <== balances[i];
  }
  partial_sum[0] <== balances[0];
  for (var i = 1; i < N; i++) {
    partial_sum[i] <== partial_sum[i-1] + balances[i];
  }
  signal totalSum;
  totalSum <== partial_sum[N-1];
  signal difference;
  difference <== reserves - totalSum;
  component diffCheck = RangeCheck(256);
  diffCheck.in <== difference;
  reservesPublic <== reserves;
    merkleRootPublic <== merkleRoot;
}

component main = Solvency(16);
