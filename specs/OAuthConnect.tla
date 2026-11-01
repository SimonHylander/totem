---------------------------- MODULE OAuthConnect ----------------------------
(***************************************************************************)
(* The OAuth connect flow of one install's credential (ADR 0012, ADR 0015, *)
(* platform/src/connections.ts), with every interleaving of:              *)
(*   - operators changing the OAuth client (a new binding object),         *)
(*   - connects started, and their callbacks taking the pending state,     *)
(*   - token exchanges that finish later,                                  *)
(*   - refreshes of the stored connection that finish later.               *)
(* Bindings and connection records are compared by identity in the code,   *)
(* so here each is a fresh number.                                         *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    States,      \* OAuth state values the model may use
    MaxBindings, \* how many OAuth clients an operator may set
    MaxRecords   \* how many connection records may be written

None == 0
NoExchange == [pinned |-> None, at |-> None]

VARIABLES
    binding,     \* the app's current binding, or None
    pending,     \* pending[s]: the binding a pending connect pinned, None when absent or taken
    taken,       \* taken[s]: how many callbacks took state s
    exchange,    \* exchange[s]: [pinned, at] while a token exchange runs, else NoExchange
    conn,        \* the stored connection record, or None
    recBinding,  \* recBinding[r]: the binding that issued record r
    records,     \* records written so far
    refresh,     \* the record a running refresh read, or None
    lost,        \* TRUE once a write replaced a record its writer had not read
    leaked       \* TRUE once credentials/get handed out a record of a binding that is not current

vars == <<binding, pending, taken, exchange, conn, recBinding, records, refresh, lost, leaked>>

Bindings == 1..MaxBindings
Records == 1..MaxRecords

Init ==
    /\ binding = None
    /\ pending = [s \in States |-> None]
    /\ taken = [s \in States |-> 0]
    /\ exchange = [s \in States |-> NoExchange]
    /\ conn = None
    /\ recBinding = [r \in Records |-> None]
    /\ records = 0
    /\ refresh = None
    /\ lost = FALSE
    /\ leaked = FALSE

(* An operator sets a different client: setOAuthClient makes a new binding. *)
SetClient ==
    /\ binding < MaxBindings
    /\ binding' = binding + 1
    /\ UNCHANGED <<pending, taken, exchange, conn, recBinding, records, refresh, lost, leaked>>

(* startOAuthConnect records the current binding under a fresh state. *)
Start(s) ==
    /\ binding # None
    /\ pending[s] = None /\ taken[s] = 0
    /\ pending' = [pending EXCEPT ![s] = binding]
    /\ UNCHANGED <<binding, taken, exchange, conn, recBinding, records, refresh, lost, leaked>>

(* finishOAuthConnect: take the pending connect (atomic), then exchange the code only if the  *)
(* app's binding is still the one the connect pinned.                                        *)
Callback(s) ==
    /\ pending[s] # None
    /\ pending' = [pending EXCEPT ![s] = None]
    /\ taken' = [taken EXCEPT ![s] = @ + 1]
    /\ IF pending[s] = binding
         THEN exchange' = [exchange EXCEPT ![s] = [pinned |-> pending[s], at |-> binding]]
         ELSE UNCHANGED exchange
    /\ UNCHANGED <<binding, conn, recBinding, records, refresh, lost, leaked>>

(* The token response arrives. setConnection replaces the record whatever it was. *)
Exchanged(s) ==
    /\ exchange[s] # NoExchange
    /\ records < MaxRecords
    /\ records' = records + 1
    /\ recBinding' = [recBinding EXCEPT ![records + 1] = exchange[s].pinned]
    /\ conn' = records + 1
    /\ exchange' = [exchange EXCEPT ![s] = NoExchange]
    /\ UNCHANGED <<binding, pending, taken, refresh, lost, leaked>>

(* credentials/get finds the connection stale and starts the one refresh for that record. *)
RefreshStart ==
    /\ refresh = None
    /\ conn # None /\ recBinding[conn] = binding
    /\ refresh' = conn
    /\ UNCHANGED <<binding, pending, taken, exchange, conn, recBinding, records, lost, leaked>>

(* refreshOnce: write the new record, or delete on invalid_grant, only if the stored record is *)
(* still the one it read. A reconnect that landed meanwhile wins. Then getCredential hands    *)
(* out the result only if it belongs to the binding that is current now.                      *)
Refreshed(revoked) ==
    /\ refresh # None
    /\ records < MaxRecords
    /\ IF conn = refresh
         THEN /\ IF revoked
                   THEN /\ conn' = None /\ UNCHANGED <<records, recBinding>>
                   ELSE /\ records' = records + 1
                        /\ recBinding' = [recBinding EXCEPT ![records + 1] = recBinding[refresh]]
                        /\ conn' = records + 1
         ELSE UNCHANGED <<conn, records, recBinding>>
    /\ LET handed == IF conn' # None /\ recBinding'[conn'] = binding THEN conn' ELSE None
       IN leaked' = (leaked \/ (handed # None /\ recBinding'[handed] # binding))
    /\ lost' = (lost \/ (conn # refresh /\ conn' # conn))
    /\ refresh' = None
    /\ UNCHANGED <<binding, pending, taken, exchange>>

Next ==
    \/ SetClient
    \/ \E s \in States : Start(s) \/ Callback(s) \/ Exchanged(s)
    \/ RefreshStart
    \/ \E revoked \in BOOLEAN : Refreshed(revoked)

Spec == Init /\ [][Next]_vars

(* A state value completes at most one connect. *)
StateUsedOnce == \A s \in States : taken[s] <= 1

(* A code is only exchanged at the token endpoint of the binding the connect pinned. *)
ExchangeAtPinned == \A s \in States : exchange[s].pinned = exchange[s].at

(* A refresh never replaces or deletes a record written after it read, such as a reconnect. *)
NoLostReconnect == ~lost

(* credentials/get hands out only a record issued under the binding current at that moment, *)
(* even when the client changed while the refresh ran.                                      *)
NoStaleGrant == ~leaked

TypeOK ==
    /\ binding \in {None} \cup Bindings
    /\ conn \in {None} \cup Records
    /\ refresh \in {None} \cup Records
=============================================================================
