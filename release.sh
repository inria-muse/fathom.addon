#!/bin/bash
REL=$1
if [ -z "$REL" ]; then 
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

echo "prepare release=" $REL " ..."

# new xpi

cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf

git commit -a -m "xpi release "$REL
git tag $REL
git push

# web release

cp -f fathom.xpi ../fathom.web/
cp -f fathom.update.rdf ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$REL
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'