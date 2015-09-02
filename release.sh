#!/bin/bash
REL=$1
if [ -z "$REL" ]; then 
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "prepare release " $TAG " ..."

# FIXME: remove once final
echo "do not release from this branch yet!! aborting ..."
exit 0

# update package.json + update.rdf
cp package.json package.json.save
cp fathom.update.rdf fathom.update.rdf.save

sed 's/"version": ".*"/"version": "'$REL'"/' <package.json.save >package.json
sed 's/<em:version>.*<\/em:version>/<em:version>'$REL'<\/em:version>/' <fathom.update.rdf.save >fathom.update.rdf

# build xpi
XPI=jid1-o49GgyEaRRmXPA@jetpack-$REL.xpi
jpm xpi
if [ ! -f "$XPI" ] then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv package.json.save package.json
    mv fathom.update.save fathom.update.rdf
    exit 1
fi

git commit -a -m "xpi release "$TAG
git tag $TAG
git push

# keep a copy
cp $XPI dist/

# web release

cp -f $XPI ../fathom.web/fathom.xpi
cp -f fathom.update.rdf ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'