# jsos

A simulation of an imaginary OS, in a browser. For some reason.

The plan is to have as few primitives as possible, and make sure that the OS
is always fundamentally in control. This means nothing blocks, ever. All code
is run at a direct request of the OS.

The thinking behind this is that so much programming is about trying to work
around the OS, and so much more is layering on top of the OS in order to
reimplement an OS with different rules.

For example, a raw processor runs one instruction then the next forever. Most
OSs try to reimplement this behaviour but multiplied by the number of processes.
Then containers try to multiply that again on top.

Obviously lots of OSs have tried to strip back to the minimum, but the tendency
is then to just reimplement the same old things on top. Maybe instead the OS
should offer something fundamentally different than the one instruction after
another paradigm.

## Pods

Pods are like processes, but don't have a program counter or memory space, and
are entirely isolated. What they do have are lots of entry points, and a task
queue. The queue specifies which entry point to run with which state.

## States

States are memory allocations. Each pod has at least 1 state, and can ask for
more.

## Channels

Channels connect pods. They are constructed by a parent of the pods that wish
to be connected. A pod has a channel to each of its children.

## Execution

At each tick the OS tries to tick each process in the tree, starting from the
root pod0. This means finding all tasks that are queued and can have exclusive
access to a state.

After the entry points are run, syscalls are inspected.

## Syscalls

### alloc

Creates a new State.

### spawn

Creates a new Pod.

### connect

Creates a channel.

### send

Sends data to a channel.
