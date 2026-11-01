------------------------------ MODULE Upgrade ------------------------------
(***************************************************************************)
(* A provider install pinned to an app version, a consumer port bound to   *)
(* one of its actions, and port calls in flight (ADR 0013, ADR 0017).      *)
(* The app releases versions, the tenant upgrades the provider, and the    *)
(* consumer binds and unbinds, in every order. Only actions are modelled:  *)
(* compare() also breaks on changed signatures and needs, which this       *)
(* abstracts as "an action disappears".                                    *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT MaxCalls  \* how many port calls may be in flight at once

(* Releases[v]: the actions version v provides. v2 adds c, v3 drops a (Breaking), v4 brings a *)
(* back and adds d, so a provider on v2 can only reach v4.                                     *)
Releases == <<{"a", "b"}, {"a", "b", "c"}, {"b", "c"}, {"a", "b", "c", "d"}>>

None == 0
Unbound == "unbound"
Actions == UNION {Releases[v] : v \in 1..Len(Releases)}

VARIABLES
    released,   \* how many versions the app has released; the latest is Releases[released]
    pinned,     \* the provider install's version, or None before it exists
    bound,      \* the action the consumer's port is bound to, or Unbound
    calls       \* actions of port calls forwarded to the provider and not yet answered

vars == <<released, pinned, bound, calls>>

Init == released = 1 /\ pinned = None /\ bound = Unbound /\ calls = <<>>

Release == released < Len(Releases) /\ released' = released + 1 /\ UNCHANGED <<pinned, bound, calls>>

(* createInstall or bindPort's findOrPut makes the provider install on the latest version. *)
Install == pinned = None /\ pinned' = released /\ UNCHANGED <<released, bound, calls>>

(* ports/bind checks the version of the provider install it binds to: the pinned one. *)
Bind(a) ==
    /\ pinned # None
    /\ a \in Releases[pinned]
    /\ bound' = a
    /\ UNCHANGED <<released, pinned, calls>>

Unbind == bound # Unbound /\ bound' = Unbound /\ UNCHANGED <<released, pinned, calls>>

(* upgradeInstall: Patch or Additive only, so nothing the pinned version provides disappears. *)
Upgrade ==
    /\ pinned # None /\ pinned < released
    /\ Releases[pinned] \subseteq Releases[released]
    /\ pinned' = released
    /\ UNCHANGED <<released, bound, calls>>

(* forward() then invoke(): the consumer's app calls its port while it is bound, and invoke *)
(* refuses an action the provider's pinned version does not provide.                         *)
Call == bound # Unbound /\ bound \in Releases[pinned] /\ Len(calls) < MaxCalls /\ calls' = Append(calls, bound) /\ UNCHANGED <<released, pinned, bound>>

Answer == calls # <<>> /\ calls' = Tail(calls) /\ UNCHANGED <<released, pinned, bound>>

Next == Release \/ Install \/ (\E a \in Actions : Bind(a)) \/ Unbind \/ Upgrade \/ Call \/ Answer

Spec == Init /\ [][Next]_vars

(* A binding always names an action the provider's pinned version provides. *)
BindingProvided == bound # Unbound => bound \in Releases[pinned]

(* An upgrade never removes the action of a call that is still in flight. *)
CallsProvided == \A i \in 1..Len(calls) : calls[i] \in Releases[pinned]
=============================================================================
