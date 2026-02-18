import { useEffect, useState } from "react";
import {
  type DocumentData,
  type DocumentReference,
  type Query,
  onSnapshot,
} from "firebase/firestore";

interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface CollectionState<T> {
  data: Array<T & { id: string }>;
  loading: boolean;
  error: string | null;
}

export function useFirestoreDocument<T = DocumentData>(
  reference: DocumentReference<DocumentData> | null,
): DocState<T> {
  const referencePath = reference?.path ?? null;
  const [state, setState] = useState<DocState<T>>({
    data: null,
    loading: Boolean(referencePath),
    error: null,
  });

  useEffect(() => {
    if (!reference) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });

    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        setState({
          data: snapshot.exists() ? (snapshot.data() as T) : null,
          loading: false,
          error: null,
        });
      },
      (error) => {
        setState({ data: null, loading: false, error: error.message });
      },
    );

    return unsubscribe;
  }, [referencePath]);

  return state;
}

export function useFirestoreCollection<T = DocumentData>(
  queryRef: Query<DocumentData> | null,
): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    data: [],
    loading: Boolean(queryRef),
    error: null,
  });

  useEffect(() => {
    if (!queryRef) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState({ data: [], loading: true, error: null });

    const unsubscribe = onSnapshot(
      queryRef,
      (snapshot) => {
        setState({
          data: snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) })),
          loading: false,
          error: null,
        });
      },
      (error) => {
        setState({ data: [], loading: false, error: error.message });
      },
    );

    return unsubscribe;
  }, [queryRef]);

  return state;
}
