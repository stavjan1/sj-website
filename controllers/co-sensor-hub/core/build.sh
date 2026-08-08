#!/bin/sh
set -e
gcc -std=c99 -Wall -Wextra -Wpedantic -O2 -o test_co_core co_core.c test_co_core.c -lm
./test_co_core
