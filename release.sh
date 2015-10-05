#!/bin/bash
REL=$1
if [ -z "$REL" ]; then
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "prepare release " $TAG " ..."

# update package.json + update.rdf
PKG=package.json
cp $PKG $PKG.save
sed 's/"version": ".*"/"version": "'$REL'"/' <$PKG.save >$PKG

RDF=fathom.update.rdf
cp $RDF $RDF.save
sed 's/<em:version>.*<\/em:version>/<em:version>'$REL'<\/em:version>/' <$RDF.save >$REF

# build xpi
XPI=jid1-o49GgyEaRRmXPA@jetpack-$REL.xpi

jpm xpi

if [ ! -f "$XPI" ] then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv $PKG.save $PKG
    mv $RDF.save $RDF
    exit 1
fi

git commit -a -m "xpi release "$TAG
git tag $TAG
git push

# keep a copy
cp $XPI dist/fathom-$REL.xpi

# web release
# FIXME: how to automate with AMO signing ..  ?

cp -f $XPI ../fathom.web/fathom.xpi
cp -f $RDF ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'