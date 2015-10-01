#!/bin/sh

# There's some name conflict with "buffer" and the module is not found by require unless renamed.
mv node_modules/buffer node_modules/buffer.js

