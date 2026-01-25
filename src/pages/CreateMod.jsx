import { useNavigate } from 'react-router-dom';
import ModEditor from '../components/ModEditor/ModEditor';

export default function CreateMod() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <ModEditor
        isCreating={true}
        onCancel={() => navigate('/')}
      />
    </div>
  );
}

